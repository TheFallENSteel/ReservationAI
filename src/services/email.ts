import nodemailer from 'nodemailer';
import { getSettings } from '../data/repository.js';
import { addLog } from '../data/adminRepository.js';
import type { Reservation } from '../data/mockData.js';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Configures SMTP transport if environment variables are set, otherwise falls back to logging transport.
const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }

  return null;
};

export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  const from = process.env.EMAIL_FROM || 'Reservation System <noreply@reserverestaurant.cz>';
  const transporter = createTransporter();

  try {
    if (transporter) {
      await transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html
      });
      await addLog(`email.sent:${options.to}`, 'system');
      return true;
    }

    // Fallback mode: log to server console and record in audit logs so emails are verifiable in testing/dev
    console.log(`\n================== [OUTGOING EMAIL] ==================`);
    console.log(`TO: ${options.to}`);
    console.log(`FROM: ${from}`);
    console.log(`SUBJECT: ${options.subject}`);
    console.log(`BODY:\n${options.text}`);
    console.log(`======================================================\n`);

    await addLog(`email.dispatched_fallback:${options.to}`, 'system');
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    await addLog(`email.failed:${options.to}`, 'system');
    return false;
  }
};

export const renderTemplate = (template: string, vars: Record<string, string | number | undefined>): string => {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(value ?? ''));
  }
  return result;
};

export const sendReservationEmail = async (
  type: 'confirmation' | 'change' | 'verification2fa' | 'cancellation',
  reservation: Reservation,
  extraVars: Record<string, string | number | undefined> = {},
  baseUrl?: string
) => {
  if (!reservation.email || !reservation.email.includes('@')) return false;

  const currentSettings = await getSettings();
  const templates = (currentSettings as any).emailTemplates ?? {};

  const defaultTemplates = {
    confirmation:
      'Dobrý den {guestName},\n\nVaše rezervace (kód: {reservationId}) pro {guestCount} osob dne {date} od {startTime} do {endTime} je potvrzena.\n\nTěšíme se na Vaši návštěvu!',
    change:
      'Dobrý den {guestName},\n\nVaše rezervace (kód: {reservationId}) byla upravena na nový termín dne {date} od {startTime} do {endTime} pro {guestCount} osob.\n\nV případě dotazů nás kontaktujte.',
    verification2fa:
      'Dobrý den {guestName},\n\npro potvrzení Vaší rezervace dne {date} ({startTime}–{endTime}) zadejte ověřovací kód:\n\n{verificationCode}\n\nNebo klikněte na tento odkaz:\n{confirmationUrl}\n\nKód je platný po dobu 15 minut.',
    cancellation:
      'Dobrý den {guestName},\n\nVaše rezervace na jméno {guestName} dne {date} ({startTime}–{endTime}) byla zrušena.\n\nDěkujeme za pochopení.'
  };

  const templateStr: string = templates[type] || (currentSettings as any).emailTemplate || defaultTemplates[type];

  const appBase = baseUrl || process.env.BASE_URL || 'http://localhost:3000';
  const confirmationUrl = extraVars.verificationToken
    ? `${appBase}/reserve?verifyToken=${encodeURIComponent(String(extraVars.verificationToken))}&resId=${encodeURIComponent(reservation.id)}`
    : '';

  const mergedVars: Record<string, string | number | undefined> = {
    guestName: reservation.guestName,
    guestCount: reservation.guestCount,
    date: reservation.date,
    startTime: reservation.startTime,
    endTime: reservation.endTime,
    reservationId: reservation.id,
    resourceId: reservation.resourceId,
    tableName: reservation.resourceId,
    confirmationUrl,
    ...extraVars
  };

  const body = renderTemplate(templateStr, mergedVars);

  const subjects = {
    confirmation: `Potvrzení rezervace – ${reservation.date}`,
    change: `Změna rezervace – ${reservation.date}`,
    verification2fa: `Ověřovací kód pro Vaši rezervaci (${mergedVars.verificationCode || '2FA'})`,
    cancellation: `Zrušení rezervace – ${reservation.date}`
  };

  return sendEmail({
    to: reservation.email,
    subject: subjects[type] || 'Informace k rezervaci',
    text: body
  });
};

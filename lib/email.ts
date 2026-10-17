import { Resend } from 'resend';

export type SendEmail = (to: string, subject: string, html: string) => Promise<void>;

export function resendSender(): SendEmail {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? 'RedPen Maths <hello@redpenmaths.com>';
  return async (to, subject, html) => {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(`email failed: ${error.message}`);
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function waitlistConfirmEmail(confirmUrl: string) {
  return {
    subject: 'Confirm your email for your free marked practice exam',
    html: `<p>Hi,</p>
<p>Thanks for joining the RedPen Maths list. Please confirm your email so we can tell you when calculus practice exams open. Your first marked one is free:</p>
<p><a href="${esc(confirmUrl)}">Confirm my email</a></p>
<p>If you didn't ask for this, ignore this email and you won't hear from us again.</p>
<p>RedPen Maths, by DefyScale</p>`,
  };
}

export function purchaseEmail(siteUrl: string) {
  return {
    subject: "You're in: your RedPen Maths early-bird pass",
    html: `<p>Thank you for backing RedPen Maths. Paddle has sent your receipt separately.</p>
<p>What happens next: one short email a month on how the build is going, then a login invite when RedPen Maths opens in January 2027.</p>
<p>Changed your mind? You can have a full refund any time before launch: just reply to this email. After launch there is a 14-day money-back guarantee.</p>
<p><a href="${esc(siteUrl)}/refunds">Refund policy</a> · RedPen Maths, by DefyScale</p>`,
  };
}

/** The monthly update, sent by hand. The body is written each month; this adds the footer. */
export function buildUpdateEmail(bodyHtml: string, unsubscribeUrl: string) {
  return {
    subject: "RedPen Maths: this month's build update",
    html: `${bodyHtml}
<hr><p style="font-size:12px;color:#5b6675">You're getting this because you joined the RedPen Maths waitlist or bought an early-bird pass. <a href="${esc(unsubscribeUrl)}">Unsubscribe</a>.</p>`,
  };
}

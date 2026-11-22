import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import nodemailer, { type Transporter } from "nodemailer";
import config from "@/config";
import { logger } from "@/shared/logger";

/**
 * SMTP email with Handlebars templates from src/views/<name>.hbs.
 * A no-op (logged) when SMTP isn't configured. Never throws.
 */
const VIEWS_DIR = path.join(__dirname, "..", "views");
const cache = new Map<string, HandlebarsTemplateDelegate>();

const render = (name: string, data: Record<string, unknown>) => {
  let tpl = cache.get(name);
  if (!tpl) {
    tpl = Handlebars.compile(fs.readFileSync(path.join(VIEWS_DIR, `${name}.hbs`), "utf8"));
    cache.set(name, tpl);
  }
  return tpl(data);
};

let transporter: Transporter | undefined;
const transport = () =>
  (transporter ??= nodemailer.createTransport({
    host: config.smtp!.host,
    port: config.smtp!.port,
    secure: config.smtp!.secure,
    auth: { user: config.smtp!.user, pass: config.smtp!.pass },
  }));

export const sendEmail = async (opts: {
  to: string | string[];
  subject: string;
  template: string;
  data: Record<string, unknown>;
}): Promise<boolean> => {
  if (!config.smtp) {
    logger.debug({ subject: opts.subject }, "email skipped (SMTP not configured)");
    return false;
  }
  try {
    await transport().sendMail({
      from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
      to: opts.to,
      subject: opts.subject,
      html: render(opts.template, opts.data),
    });
    return true;
  } catch (err) {
    logger.error({ subject: opts.subject, err: (err as Error).message }, "email failed");
    return false;
  }
};

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { normalizeEmail } from "../utils/email.js";
import { makeLimiter, rateLimit } from "../utils/limiter.js";

const OTP_TTL = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const COMMON = new Set(["password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "iloveyou", "11111111", "abcd1234", "himusic123"]);
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10); // keeps login timing the same for unknown emails

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });

/**
 * Dependencies are injected so the whole flow can be tested without MongoDB or real email.
 * Env switches: ALLOWED_EMAIL_DOMAINS (default gmail.com, empty = any), ALLOWED_EMAILS (private mode),
 * ALLOW_UNVERIFIED_SIGNUP=true (skip email verification when no mail provider exists).
 */
export function createAuthRouter({ User, Otp, sendMail, otpMail, mailEnabled, env = process.env, now = () => Date.now() }) {
  const router = Router();
  const secret = () => env.JWT_SECRET;
  const sign = (u) => jwt.sign({ id: u._id }, secret(), { expiresIn: "30d" });
  const pub = (u) => ({ id: u._id, name: u.name, email: u.email });
  const hashCode = (key, purpose, code) =>
    crypto.createHmac("sha256", secret()).update(`${key}|${purpose}|${code}`).digest("hex");
  const same = (a = "", b = "") => {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const findUser = (n) => User.findOne({ $or: [{ emailKey: n.key }, { email: n.email }] });

  const ipAll = makeLimiter({ max: 60, windowMs: 15 * 60_000 });
  const loginFail = makeLimiter({ max: 8, windowMs: 15 * 60_000 });
  const acctFail = makeLimiter({ max: 20, windowMs: 15 * 60_000 });
  const otpFail = makeLimiter({ max: 15, windowMs: 15 * 60_000 });
  const sends = makeLimiter({ max: 8, windowMs: 60 * 60_000 });
  router.use(rateLimit(ipAll, (req) => `ip:${req.ip}`));

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message, ...e.extra });
      console.error("auth error:", e);
      res.status(500).json({ error: "Server error" });
    }
  };

  function checkEmailAllowed(n) {
    const domains = (env.ALLOWED_EMAIL_DOMAINS ?? "gmail.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (domains.length && !domains.includes(n.domain))
      throw httpErr(400, domains.length === 1 ? `Please use your ${domains[0]} address` : `Please use an email from: ${domains.join(", ")}`);
    const list = (env.ALLOWED_EMAILS || "").split(",").map((s) => normalizeEmail(s)?.key).filter(Boolean);
    if (list.length && !list.includes(n.key)) throw httpErr(403, "Sign-ups are closed. Only invited emails can create an account.");
  }

  function checkPassword(pw) {
    if (typeof pw !== "string" || pw.length < 8) throw httpErr(400, "Password must be at least 8 characters");
    if (pw.length > 72) throw httpErr(400, "Password is too long (max 72 characters)");
    if (COMMON.has(pw.toLowerCase())) throw httpErr(400, "That password is too common. Choose another one.");
  }

  // create + email a fresh code (respecting the 60s cooldown)
  async function issue(purpose, n, extra = {}) {
    const sendCheck = sends.check(`send:${n.key}`);
    if (!sendCheck.ok) throw httpErr(429, "Too many codes requested. Try again later.", { retryAfter: sendCheck.retryAfter });
    const prev = await Otp.findOne({ emailKey: n.key, purpose });
    if (prev?.sentAt) {
      const wait = Math.ceil((RESEND_MS - (now() - new Date(prev.sentAt).getTime())) / 1000);
      if (wait > 0) throw httpErr(429, `Please wait ${wait}s before asking for another code`, { retryAfter: wait });
    }
    const code = newCode();
    await Otp.updateOne(
      { emailKey: n.key, purpose },
      {
        $set: {
          email: n.email,
          codeHash: hashCode(n.key, purpose, code),
          attempts: 0,
          sentAt: new Date(now()),
          expiresAt: new Date(now() + OTP_TTL),
          ...extra,
        },
      },
      { upsert: true }
    );
    sends.hit(`send:${n.key}`);
    try {
      await sendMail({ to: n.email, ...otpMail(code, purpose) });
    } catch (e) {
      await Otp.deleteOne({ emailKey: n.key, purpose });
      console.error("OTP email failed:", e.message);
      throw httpErr(502, "Could not send the email right now. Try again in a minute.");
    }
  }

  // check a code; returns the Otp row when correct
  async function consume(purpose, n, code) {
    if (!/^\d{6}$/.test(String(code || ""))) throw httpErr(400, "Enter the 6-digit code");
    const c = otpFail.check(`otp:${n.key}`);
    if (!c.ok) throw httpErr(429, "Too many wrong codes. Try again later.", { retryAfter: c.retryAfter });
    const rec = await Otp.findOne({ emailKey: n.key, purpose });
    if (!rec || new Date(rec.expiresAt).getTime() < now()) throw httpErr(400, "That code has expired. Ask for a new one.");
    if (rec.attempts >= MAX_ATTEMPTS) {
      await Otp.deleteOne({ emailKey: n.key, purpose });
      throw httpErr(429, "Too many wrong tries. Ask for a new code.");
    }
    if (!same(rec.codeHash, hashCode(n.key, purpose, String(code)))) {
      otpFail.hit(`otp:${n.key}`);
      await Otp.updateOne({ emailKey: n.key, purpose }, { $inc: { attempts: 1 } });
      throw httpErr(400, `Wrong code. ${Math.max(0, MAX_ATTEMPTS - rec.attempts - 1)} tries left.`);
    }
    return rec;
  }

  async function createUser({ name, n, passwordHash }) {
    try {
      return await User.create({ name, email: n.email, emailKey: n.key, password: passwordHash });
    } catch (e) {
      if (e?.code === 11000) throw httpErr(409, "This email is already registered. Log in instead.");
      throw e;
    }
  }

  // 1) sign up: validate, store pending signup, email a code. No account yet.
  router.post("/register", rateLimit(makeLimiter({ max: 15, windowMs: 60 * 60_000 }), (req) => `reg:${req.ip}`), wrap(async (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 60);
    const n = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!name) throw httpErr(400, "Enter your name");
    if (!n) throw httpErr(400, "Enter a valid email address");
    checkEmailAllowed(n);
    checkPassword(password);
    if (await findUser(n)) throw httpErr(409, "This email is already registered. Log in instead.");
    const passwordHash = await bcrypt.hash(password, 10);

    if (!mailEnabled()) {
      if (env.ALLOW_UNVERIFIED_SIGNUP === "true") {
        const user = await createUser({ name, n, passwordHash });
        return res.json({ token: sign(user), user: pub(user) });
      }
      throw httpErr(503, "Email verification is not set up on the server yet. The owner needs to configure it (see README).");
    }
    await issue("signup", n, { name, passwordHash });
    res.json({ pending: true, email: n.email, resendIn: RESEND_MS / 1000 });
  }));

  // 2) confirm the code -> account is created and logged in
  router.post("/verify", wrap(async (req, res) => {
    const n = normalizeEmail(req.body?.email);
    if (!n) throw httpErr(400, "Enter a valid email address");
    const rec = await consume("signup", n, req.body?.code);
    const user = await createUser({ name: rec.name, n, passwordHash: rec.passwordHash });
    await Otp.deleteOne({ emailKey: n.key, purpose: "signup" });
    res.json({ token: sign(user), user: pub(user) });
  }));

  router.post("/resend", wrap(async (req, res) => {
    const n = normalizeEmail(req.body?.email);
    if (!n) throw httpErr(400, "Enter a valid email address");
    const rec = await Otp.findOne({ emailKey: n.key, purpose: "signup" });
    if (!rec) throw httpErr(400, "Sign up again to get a new code.");
    await issue("signup", n, {});
    res.json({ ok: true, resendIn: RESEND_MS / 1000 });
  }));

  router.post("/login", wrap(async (req, res) => {
    const n = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!n || !password) throw httpErr(400, "Enter your email and password");
    const k1 = `lf:${req.ip}|${n.key}`, k2 = `la:${n.key}`;
    const c = [loginFail.check(k1), acctFail.check(k2)].find((x) => !x.ok);
    if (c) throw httpErr(429, "Too many wrong attempts. Try again in a few minutes, or reset your password.", { retryAfter: c.retryAfter });
    const user = await findUser(n);
    const ok = await bcrypt.compare(password, user?.password || DUMMY_HASH);
    if (!user || !ok) {
      loginFail.hit(k1);
      acctFail.hit(k2);
      throw httpErr(401, "Wrong email or password");
    }
    loginFail.reset(k1);
    if (!user.emailKey) {
      user.emailKey = n.key; // older accounts get the canonical key on first login
      try {
        await user.save();
      } catch {}
    }
    res.json({ token: sign(user), user: pub(user) });
  }));

  // forgot password: always answers the same, so it can't be used to find out who has an account
  router.post("/forgot", wrap(async (req, res) => {
    const n = normalizeEmail(req.body?.email);
    if (!n) throw httpErr(400, "Enter a valid email address");
    if (!mailEnabled()) throw httpErr(503, "Password reset needs email to be set up on the server (see README).");
    const user = await findUser(n);
    if (user) {
      try {
        await issue("reset", n, {});
      } catch (e) {
        // never reveal (via errors or cooldowns) whether this email has an account
        console.error("forgot-password:", e.message);
      }
    }
    res.json({ ok: true, resendIn: RESEND_MS / 1000 });
  }));

  router.post("/reset", wrap(async (req, res) => {
    const n = normalizeEmail(req.body?.email);
    if (!n) throw httpErr(400, "Enter a valid email address");
    checkPassword(req.body?.password);
    await consume("reset", n, req.body?.code);
    const user = await findUser(n);
    if (!user) throw httpErr(400, "That code has expired. Ask for a new one.");
    user.password = await bcrypt.hash(req.body.password, 10);
    if (!user.emailKey) user.emailKey = n.key;
    await user.save();
    await Otp.deleteOne({ emailKey: n.key, purpose: "reset" });
    loginFail.reset(`lf:${req.ip}|${n.key}`);
    acctFail.reset(`la:${n.key}`);
    res.json({ token: sign(user), user: pub(user) });
  }));

  return router;
}

// real wiring (used by server.js)
export default async function realAuthRouter() {
  const [{ default: User }, { default: Otp }, mail] = await Promise.all([
    import("../models/User.js"),
    import("../models/Otp.js"),
    import("../mail.js"),
  ]);
  return createAuthRouter({
    User,
    Otp,
    sendMail: (m) => mail.sendMail(m),
    otpMail: mail.otpMail,
    mailEnabled: () => !!mail.mailProvider(),
  });
}

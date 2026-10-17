import mongoose from "mongoose";

// One row per (email, purpose). "signup" rows keep the name + password hash until the code is confirmed,
// so no account exists for an email nobody verified. Rows delete themselves after expiresAt.
const otpSchema = new mongoose.Schema({
  emailKey: { type: String, required: true },
  purpose: { type: String, enum: ["signup", "reset"], required: true },
  email: String,
  name: String,
  passwordHash: String,
  codeHash: String,
  attempts: { type: Number, default: 0 },
  sentAt: Date,
  expiresAt: { type: Date, index: { expires: 0 } },
});
otpSchema.index({ emailKey: 1, purpose: 1 }, { unique: true });

export default mongoose.model("Otp", otpSchema);

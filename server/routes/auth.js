import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = Router();
const sign = (u) =>
  jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
const pub = (u) => ({ id: u._id, name: u.name, email: u.email });

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6)
      return res
        .status(400)
        .json({ error: "Name, email and password (min 6) required" });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: "Email already registered" });
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 10),
    });
    res.json({ token: sign(user), user: pub(user) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || "").toLowerCase() });
    if (!user || !(await bcrypt.compare(password || "", user.password)))
      return res.status(401).json({ error: "Wrong email or password" });
    res.json({ token: sign(user), user: pub(user) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;

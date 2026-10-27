import mongoose from "mongoose";

// Remembers which audio file matched a song, so the next play (even after a server restart) starts instantly.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: Object,
  expiresAt: { type: Date, index: { expires: 0 } },
});

export default mongoose.model("Resolved", schema);

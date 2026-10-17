import mongoose from "mongoose";

const songSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: String,
    artist: String,
    thumbnail: String,
    duration: Number,
  },
  { _id: false }
);

const playlistSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cover: { type: String, default: "" },
  songs: [songSchema],
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    // canonical email (gmail dots/+tags removed) so one inbox can't make many accounts
    emailKey: { type: String, unique: true, sparse: true },
    password: { type: String, required: true },
    liked: [songSchema],
    history: [songSchema],
    playlists: [playlistSchema],
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);

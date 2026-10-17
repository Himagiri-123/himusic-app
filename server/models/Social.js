import mongoose from "mongoose";

const song = { id: { type: String, required: true }, title: String, artist: String, thumbnail: String, duration: Number, addedBy: String };
const songSchema = new mongoose.Schema(song, { _id: false });

// read-only snapshot of a playlist that can be opened from a link
export const Share = mongoose.model(
  "Share",
  new mongoose.Schema(
    {
      code: { type: String, unique: true, index: true },
      name: String,
      owner: String,
      cover: { type: String, default: "" },
      songs: [songSchema],
    },
    { timestamps: true }
  )
);

// playlist several users can add songs to
export const Collab = mongoose.model(
  "Collab",
  new mongoose.Schema(
    {
      code: { type: String, unique: true, index: true },
      name: { type: String, required: true },
      owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
      members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
      memberNames: { type: Map, of: String, default: {} },
      songs: [songSchema],
    },
    { timestamps: true }
  )
);

// one row per song play (>= 30 s) for the yearly Wrapped
export const Play = mongoose.model(
  "Play",
  new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, index: true },
    id: String,
    title: String,
    artist: String,
    thumbnail: String,
    secs: Number,
    at: { type: Date, default: Date.now, index: true },
  })
);

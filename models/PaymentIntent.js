import mongoose from "mongoose";

const PaymentIntentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // unique code user will put into "Гүйлгээний утга"
    code: { type: String, required: true, unique: true },

    // required amount for this subscription (e.g. 7999)
    requiredAmount: { type: Number, required: true },

    // what plan this intent is for
    plan: { type: String, enum: ["month", "year"], required: true },

    status: { type: String, enum: ["pending", "paid", "expired"], default: "pending" },

    // store matched email info (optional)
    matchedAmount: { type: Number },
    matchedDate: { type: String },
    matchedEmailUid: { type: Number },
  },
  { timestamps: true }
);

export default mongoose.model("PaymentIntent", PaymentIntentSchema);

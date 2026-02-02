import mongoose from "mongoose";

const bankSettingsSchema = new mongoose.Schema(
  {
    bankName: { type: String, default: "Golomt Bank" },
    accountNumber: { type: String, default: "330*****90" },
    accountName: { type: String, default: "YOUR NAME" },
    prices: [
      {
        months: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("BankSettings", bankSettingsSchema);

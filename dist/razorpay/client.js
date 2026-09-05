import Razorpay from 'razorpay';
import dotenv from 'dotenv';
dotenv.config();
const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;
if (!key_id || !key_secret) {
    console.warn("WARNING: Razorpay credentials not found in environment variables.");
}
export const razorpay = new Razorpay({
    key_id: key_id || 'dummy_key_id',
    key_secret: key_secret || 'dummy_key_secret',
});
//# sourceMappingURL=client.js.map
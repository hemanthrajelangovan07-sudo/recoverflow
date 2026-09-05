import { getPaymentFailure } from '../tools/read.js';
async function main() {
    const args = process.argv.slice(2);
    const paymentId = args[0];
    if (!paymentId) {
        console.error("Usage: npx tsx src/scripts/test-phase0.ts <payment_id>");
        process.exit(1);
    }
    try {
        const result = await getPaymentFailure(paymentId);
        console.log("Success! get_payment_failure returned:");
        console.log(JSON.stringify(result, null, 2));
    }
    catch (error) {
        console.error("Error calling get_payment_failure:");
        console.error(error.message);
    }
}
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
//# sourceMappingURL=test-phase0.js.map
/**
 * Render the invoice test-cases into docs/samples/.
 *
 *   npm run samples -w backend
 *
 * Uses the real generator with fixture orders, so the samples are exactly what
 * a customer would receive — no mocking of the layout code.
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { generateInvoicePdf } from '../services/invoiceService';

const OUT = path.resolve(__dirname, '../../../docs/samples');

const sellerAddress = [
  'Keharsh Enterprises (Sole Proprietorship)',
  'S/N. 12, Viru City Gym Road, Inside Jalori Gate,',
  'Jodhpur - 342001, Rajasthan, India',
];

const base = {
  id: 'sample',
  user_email: 'disha.agarwal@example.com',
  users: { email: 'disha.agarwal@example.com' },
  notes: '',
  invoice_issued_at: '2026-08-06T00:00:00.000Z',
  created_at: '2026-08-06T00:00:00.000Z',
  subtotal: 0,
  discount: 0,
  tax: 0,
  shipping_fee: 0,
  total: 0,
  invoice_number: 'MV/26-27/000123',
  order_items: [],
};

const prod5 = (name: string, sku: string) => ({ seo_metadata: { gst_rate: 5 } });

async function main() {
  mkdirSync(OUT, { recursive: true });

  const cases: Array<{ file: string; order: any }> = [
    {
      // The reference order itself: 1 item, prepaid, West Bengal -> IGST.
      file: '01-prepaid-1-item-igst.pdf',
      order: {
        ...base,
        order_number: 'MV-139559',
        payment_method: 'PayOnline (via PayU)',
        payment_status: 'paid',
        payu_mihpayid: '29972971247',
        subtotal: 699,
        tax: 33.29,
        shipping_fee: 50,
        total: 749,
        billing_address: {
          fullName: 'Disha Agarwal',
          addressLine: '10 Dr A Bani Dutta Road, Mohini Apartment',
          city: 'Howrah',
          state: 'West Bengal',
          zipCode: '711106',
          phone: '9674472700',
        },
        shipping_address: {
          fullName: 'Disha Agarwal',
          addressLine: '10 Dr A Bani Dutta Road, Mohini Apartment',
          city: 'Howrah',
          state: 'West Bengal',
          zipCode: '711106',
          phone: '9674472700',
        },
        order_items: [
          {
            product_name: 'Joint Pain Oil',
            sku: 'MRV-PRO-100ML',
            quantity: 1,
            price: 699,
            total: 699,
            products: { seo_metadata: { gst_rate: 5 } },
          },
        ],
      },
    },
    {
      file: '02-prepaid-multi-item.pdf',
      order: {
        ...base,
        order_number: 'MV-139602',
        invoice_number: 'MV/26-27/000124',
        payment_method: 'PayOnline (via PayU)',
        payment_status: 'paid',
        payu_mihpayid: '29972971888',
        subtotal: 5497,
        tax: 261.76,
        shipping_fee: 0,
        total: 5497,
        billing_address: {
          fullName: 'Rahul Sharma',
          addressLine: 'Flat 402, Sunrise Residency, 12th Main Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          zipCode: '560038',
          phone: '9845012345',
        },
        shipping_address: {
          fullName: 'Rahul Sharma',
          addressLine: 'Flat 402, Sunrise Residency, 12th Main Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          zipCode: '560038',
          phone: '9845012345',
        },
        order_items: [
          { product_name: 'Ashwagandha Capsule 60', sku: 'MRV-CAP-060', quantity: 2, price: 1299, total: 2598, products: prod5('', '') },
          { product_name: 'Liver Detox Churna', sku: 'MRV-CHN-200', quantity: 1, price: 899, total: 899, products: prod5('', '') },
          { product_name: 'Joint Pain Oil 100ml', sku: 'MRV-PRO-100ML', quantity: 1, price: 699, total: 699, products: prod5('', '') },
          {
            product_name: 'Calm Mind Essential Oil Blend with Lavender and Sweet Orange for Relaxation and Better Sleep',
            sku: 'MRV-OIL-CALM-30',
            quantity: 1,
            price: 1301,
            total: 1301,
            products: prod5('', ''),
          },
        ],
      },
    },
    {
      file: '03-cod-unpaid.pdf',
      order: {
        ...base,
        order_number: 'MV-139755',
        invoice_number: 'MV/26-27/000125',
        payment_method: 'Cash On Delivery',
        payment_status: 'pending',
        subtotal: 1398,
        tax: 66.57,
        shipping_fee: 100,
        total: 1498,
        billing_address: {
          fullName: 'Meera Nair',
          addressLine: 'B-14, Green Meadows, Vypin',
          city: 'Kochi',
          state: 'Kerala',
          zipCode: '682019',
          phone: '9820456123',
        },
        shipping_address: {
          fullName: 'Meera Nair',
          addressLine: 'B-14, Green Meadows, Vypin',
          city: 'Kochi',
          state: 'Kerala',
          zipCode: '682019',
          phone: '9820456123',
        },
        order_items: [
          { product_name: 'Joint Pain Oil', sku: 'MRV-PRO-100ML', quantity: 2, price: 699, total: 1398, products: prod5('', '') },
        ],
      },
    },
    {
      file: '04-rajasthan-cgst-sgst.pdf',
      order: {
        ...base,
        order_number: 'MV-139811',
        invoice_number: 'MV/26-27/000126',
        payment_method: 'PayOnline (via PayU)',
        payment_status: 'paid',
        payu_mihpayid: '29972972341',
        subtotal: 699,
        tax: 33.29,
        shipping_fee: 50,
        total: 749,
        billing_address: {
          fullName: 'Kavita Sharma',
          addressLine: '45, Shastri Nagar Extension',
          city: 'Jodhpur',
          state: 'Rajasthan',
          zipCode: '342001',
          phone: '9876543210',
        },
        shipping_address: {
          fullName: 'Kavita Sharma',
          addressLine: '45, Shastri Nagar Extension',
          city: 'Jodhpur',
          state: 'Rajasthan',
          zipCode: '342001',
          phone: '9876543210',
        },
        order_items: [
          { product_name: 'Joint Pain Oil', sku: 'MRV-PRO-100ML', quantity: 1, price: 699, total: 699, products: prod5('', '') },
        ],
      },
    },
    {
      file: '05-discount-coupon.pdf',
      order: {
        ...base,
        order_number: 'MV-139880',
        invoice_number: 'MV/26-27/000127',
        payment_method: 'PayOnline (via PayU)',
        payment_status: 'paid',
        payu_mihpayid: '29972973190',
        coupon_code: 'AYURVEDA10',
        subtotal: 1998,
        discount: 200,
        tax: 85.52,
        shipping_fee: 0,
        total: 1798,
        billing_address: {
          fullName: 'Arjun Patel',
          addressLine: '7, Nilkanth Nagar, Satellite',
          city: 'Ahmedabad',
          state: 'Gujarat',
          zipCode: '380015',
          phone: '9909887766',
        },
        shipping_address: {
          fullName: 'Arjun Patel',
          addressLine: '7, Nilkanth Nagar, Satellite',
          city: 'Ahmedabad',
          state: 'Gujarat',
          zipCode: '380015',
          phone: '9909887766',
        },
        order_items: [
          { product_name: 'Ashwagandha Capsule 60', sku: 'MRV-CAP-060', quantity: 1, price: 1299, total: 1299, products: prod5('', '') },
          { product_name: 'Liver Detox Churna', sku: 'MRV-CHN-200', quantity: 1, price: 699, total: 699, products: prod5('', '') },
        ],
      },
    },
  ];

  for (const c of cases) {
    const pdf = await generateInvoicePdf(c.order);
    const file = path.join(OUT, c.file);
    writeFileSync(file, pdf);
    console.log(`wrote ${path.relative(process.cwd(), file)}  (${pdf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
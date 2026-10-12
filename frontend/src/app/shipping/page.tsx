export default function ShippingPolicyPage() {
  return (
    <div className="bg-ivory min-h-screen py-20">
      <div className="container mx-auto px-6 max-w-4xl">
        <h1 className="text-4xl font-playfair font-bold text-deep-purple mb-10 text-center">Shipping Policy</h1>
        <div className="bg-white p-8 md:p-12 rounded-2xl shadow-sm border border-gray-100">
          
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Order Processing</h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              At MeruVeda, we begin preparing your wellness products as soon as your order is confirmed. Standard orders are typically processed and dispatched within <strong>1 to 3 business days</strong>.
            </p>
            <p className="text-gray-700 leading-relaxed">
              Orders placed on weekends or national holidays will be processed on the next business day. You will receive a confirmation email once your order has been successfully placed.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Shipping Timeline</h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              We strive to deliver your Ayurvedic wellness products as quickly as possible. Estimated delivery timelines are as follows:
            </p>
            <ul className="list-disc list-inside text-gray-700 leading-relaxed space-y-2 ml-4">
              <li><strong>Metro Cities:</strong> 3 to 7 business days</li>
              <li><strong>Non-Metro / Tier 2 & 3 Cities:</strong> 5 to 10 business days</li>
              <li><strong>Remote Areas:</strong> Up to 14 business days</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Delivery Partners</h2>
            <p className="text-gray-700 leading-relaxed">
              We partner with trusted, premium logistics providers across India to ensure that your products arrive safely and in pristine condition. Your package will be handled with care from our fulfillment center to your doorstep.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Shipping Charges</h2>
            <ul className="list-disc list-inside text-gray-700 leading-relaxed space-y-2 ml-4">
              <li><strong>Free Shipping:</strong> Enjoy complimentary shipping on all orders above ₹1000.</li>
              <li><strong>Standard Shipping:</strong> A nominal fee of ₹50 applies to orders below ₹1000.</li>
              <li><strong>Cash on Delivery (COD):</strong> COD is available across eligible locations.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Order Tracking</h2>
            <p className="text-gray-700 leading-relaxed">
              Once your order has been dispatched, you will receive an email and SMS containing your tracking number and a link to track your shipment in real-time. You can also view the status of your delivery directly from your MeruVeda account dashboard.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Delayed Deliveries</h2>
            <p className="text-gray-700 leading-relaxed">
              While we make every effort to meet our estimated delivery timelines, occasional delays may happen due to unforeseen circumstances such as extreme weather, natural disasters, or logistical disruptions. If your order is significantly delayed, please contact our support team, and we will assist you in tracking and expediting your package.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">International Shipping</h2>
            <p className="text-gray-700 leading-relaxed">
              Currently, MeruVeda only ships within India. We are working diligently to expand our holistic wellness offerings globally. Stay tuned to our newsletter for updates on international shipping.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Contact Support</h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              If you have any questions or concerns regarding your order's shipping status, our dedicated support team is here to help.
            </p>
            <div className="bg-ivory p-4 rounded-xl inline-block border border-gray-100">
              <p className="text-deep-purple font-medium">Email: <a href="mailto:customercare@meruvedawellness.com" className="text-gold hover:underline">customercare@meruvedawellness.com</a></p>
              <p className="text-deep-purple font-medium">WhatsApp: <a href="https://wa.me/918097147463" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">+91 8097147463</a></p>
              <p className="text-deep-purple font-medium">Operating Hours: Monday - Saturday, 10:00 AM - 6:00 PM</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

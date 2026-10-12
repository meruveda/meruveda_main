export default function PrivacyPolicyPage() {
  return (
    <div className="bg-ivory min-h-screen py-20">
      <div className="container mx-auto px-6 max-w-4xl">
        <h1 className="text-4xl font-playfair font-bold text-deep-purple mb-10 text-center">Privacy Policy</h1>
        <div className="bg-white p-8 md:p-12 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-gray-500 text-sm mb-8 text-center italic">Last Updated: 08th May 2026</p>
          
          <div className="mb-8">
            <p className="text-gray-700 leading-relaxed">
              MeruVeda Wellness ("MERUVEDA", "we", "our", "us") values your privacy and is committed to protecting your personal information. This Privacy Policy explains how we collect, use, store, and protect your information when you visit or make a purchase from our website. By using our website, you agree to the practices described in this Privacy Policy.
            </p>
          </div>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">1. Information We Collect</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-ivory p-5 rounded-xl border border-gray-100">
                <h3 className="font-bold text-gold mb-2">Personal Information</h3>
                <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
                  <li>Full name & Mobile number</li>
                  <li>Email address</li>
                  <li>Shipping & billing address</li>
                  <li>Payment-related information</li>
                  <li>Account login details</li>
                </ul>
              </div>
              <div className="bg-ivory p-5 rounded-xl border border-gray-100">
                <h3 className="font-bold text-gold mb-2">Order Information</h3>
                <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
                  <li>Products purchased</li>
                  <li>Transaction details</li>
                  <li>Order history</li>
                </ul>
              </div>
              <div className="bg-ivory p-5 rounded-xl border border-gray-100 md:col-span-2">
                <h3 className="font-bold text-gold mb-2">Technical Information</h3>
                <ul className="list-disc list-inside text-gray-700 text-sm space-y-1">
                  <li>IP address & Browser type</li>
                  <li>Device information</li>
                  <li>Website activity and browsing behavior</li>
                  <li>Cookies and analytics data</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">2. How We Use Your Information</h2>
            <ul className="list-disc list-inside text-gray-700 leading-relaxed space-y-2 ml-4">
              <li>Process and deliver orders</li>
              <li>Provide customer support</li>
              <li>Improve website functionality and user experience</li>
              <li>Send order updates and transactional communications</li>
              <li>Share promotional offers, newsletters, and updates</li>
              <li>Prevent fraud and unauthorized activity</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">3. Payment Security</h2>
            <p className="text-gray-700 leading-relaxed">
              MERUVEDA does not store your debit card, credit card, UPI PIN, CVV, or banking passwords. Payments are securely processed through authorized third-party payment gateways.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">4. Sharing of Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We <strong>do not sell or rent</strong> your personal information. Your information may be shared only with:
            </p>
            <div className="flex flex-wrap gap-3">
              <span className="px-3 py-1 bg-gray-50 text-gray-600 rounded-full border border-gray-200 text-sm">Logistics Partners</span>
              <span className="px-3 py-1 bg-gray-50 text-gray-600 rounded-full border border-gray-200 text-sm">Payment Gateways</span>
              <span className="px-3 py-1 bg-gray-50 text-gray-600 rounded-full border border-gray-200 text-sm">Tech Providers</span>
              <span className="px-3 py-1 bg-gray-50 text-gray-600 rounded-full border border-gray-200 text-sm">Legal Authorities (if required)</span>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-deep-purple mb-4">5. Your Rights</h2>
            <p className="text-gray-700 leading-relaxed mb-3">You may request to:</p>
            <ul className="list-disc list-inside text-gray-700 leading-relaxed space-y-2 ml-4">
              <li>Access your information</li>
              <li>Correct inaccurate information</li>
              <li>Delete your account or data (subject to legal obligations)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-deep-purple mb-4">Contact Us</h2>
            <div className="bg-ivory p-6 rounded-xl inline-block border border-gray-100 w-full md:w-auto">
              <p className="text-gray-600 mb-2">For privacy-related concerns or queries:</p>
              <p className="text-gray-800 font-medium mb-1">MERUVEDA Wellness (Keharsh Enterprises), Jodhpur, Rajasthan, India</p>
              <p className="text-deep-purple font-bold text-lg"><a href="mailto:customercare@meruvedawellness.com" className="hover:text-gold transition-colors">customercare@meruvedawellness.com</a></p>
              <p className="text-deep-purple font-semibold mt-1">WhatsApp: <a href="https://wa.me/918097147463" target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors">+91 8097147463</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

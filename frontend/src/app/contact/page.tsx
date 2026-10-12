export default function ContactPage() {
  return (
    <div className="bg-ivory min-h-screen py-20">
      <div className="container mx-auto px-6 max-w-4xl">
        <h1 className="text-4xl font-playfair font-bold text-deep-purple mb-10 text-center">Contact Us</h1>
        <div className="bg-white p-8 md:p-12 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-gray-600 text-center mb-10 max-w-2xl mx-auto">
            We would love to hear from you. Whether you have a question about our Ayurvedic products, an order, or
            anything else — our team is here to help.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Email */}
            <div className="bg-ivory p-6 rounded-xl border border-gray-100 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 bg-deep-purple text-gold rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
              </div>
              <h3 className="font-bold text-deep-purple text-lg">Email Us</h3>
              <p className="text-gray-500 text-sm">For orders, product queries, and general support:</p>
              <a
                href="mailto:customercare@meruvedawellness.com"
                className="text-deep-purple font-bold text-base hover:text-gold transition-colors break-all"
              >
                customercare@meruvedawellness.com
              </a>
            </div>

            {/* WhatsApp */}
            <div className="bg-ivory p-6 rounded-xl border border-gray-100 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 bg-[#25D366] text-white rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                </svg>
              </div>
              <h3 className="font-bold text-deep-purple text-lg">WhatsApp</h3>
              <p className="text-gray-500 text-sm">Chat with us directly on WhatsApp:</p>
              <a
                href="https://wa.me/918097147463"
                target="_blank"
                rel="noopener noreferrer"
                className="text-deep-purple font-bold text-base hover:text-gold transition-colors"
              >
                +91 8097147463
              </a>
            </div>
          </div>

          <div className="mt-10 bg-deep-purple/5 p-6 rounded-xl border border-gray-100 text-center">
            <p className="text-gray-700 font-medium mb-1">Operating Hours</p>
            <p className="text-gray-500 text-sm">Monday – Saturday &nbsp;·&nbsp; 10:00 AM – 6:00 PM IST</p>
            <p className="text-gray-400 text-xs mt-3">
              MERUVEDA Wellness is operated by Keharsh Enterprises, Jodhpur, Rajasthan, India.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

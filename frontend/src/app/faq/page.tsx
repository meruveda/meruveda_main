export default function FAQPage() {
  return (
    <div className="bg-ivory min-h-screen py-20">
      <div className="container mx-auto px-6 max-w-4xl">
        <h1 className="text-4xl font-playfair font-bold text-deep-purple mb-4 text-center">Frequently Asked Questions</h1>
        <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">Find answers to common questions about our products and shipping.</p>
        
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-deep-purple mb-2">Are your products vegan and cruelty-free?</h3>
            <p className="text-gray-700 leading-relaxed text-sm">Yes, all our formulations are 100% vegan, cruelty-free, and inspired by traditional Ayurvedic principles. We never test on animals.</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-deep-purple mb-2">How long will it take for my order to arrive?</h3>
            <p className="text-gray-700 leading-relaxed text-sm">Standard orders are typically processed within 1-3 business days. Delivery within metro cities takes 3-7 business days, while other locations may take 5-10 business days.</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-deep-purple mb-2">Do you offer Cash on Delivery (COD)?</h3>
            <p className="text-gray-700 leading-relaxed text-sm">Yes, COD is available across eligible locations in India.</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-deep-purple mb-2">Can I return a product if I don't like it?</h3>
            <p className="text-gray-700 leading-relaxed text-sm">No. As stated in our Shipping Policy, all items are non-returnable due to hygiene and safety reasons. If you receive a wrong, damaged, or expired product, please contact us within 7 days and we will arrange a replacement.</p>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-deep-purple mb-2">Do you ship internationally?</h3>
            <p className="text-gray-700 leading-relaxed text-sm">Currently, we only ship within India. We are working on expanding our delivery network globally in the future.</p>
          </div>
        </div>

      </div>
    </div>
  );
}

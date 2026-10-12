import Image from 'next/image';

export default function AboutPage() {
  return (
    <div className="bg-ivory min-h-screen">
      {/* Hero Section */}
      <section className="relative h-[60vh] min-h-[400px] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/images/ayurvedic_hero_1783843890311.png"
            alt="Ayurvedic Herbs"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40 mix-blend-multiply" />
        </div>
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-playfair font-bold text-white mb-6 drop-shadow-lg opacity-0 animate-fade-in-up">
            Our Story
          </h1>
          <p className="text-xl md:text-2xl text-white/90 font-light drop-shadow-md opacity-0 animate-fade-in-up animation-delay-200">
            Ancient wisdom, refined for the modern soul.
          </p>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="py-20 md:py-32 px-6">
        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div className="order-2 md:order-1 space-y-6">
              <div className="inline-block px-4 py-1 bg-gold/10 text-gold font-medium rounded-full text-sm tracking-widest uppercase mb-2">
                About Us
              </div>
              <h2 className="text-3xl md:text-4xl font-playfair font-bold text-deep-purple leading-tight">
                Wellness should not <br className="hidden md:block"/> feel complicated
              </h2>
              <p className="text-lg text-gray-600 leading-relaxed">
                MERUVEDA was born from a simple thought, wellness should not feel complicated.
                In today’s busy world, we often forget to slow down, eat right, breathe easy, and take care of ourselves.
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                That’s where MERUVEDA comes in. We bring the timeless wisdom of Ayurveda into modern life in a way that feels simple, practical, and easy to follow every day.
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                Inspired by the strength of Mount Meru and the knowledge of the Vedas, MERUVEDA blends traditional Ayurvedic wisdom with premium quality and everyday convenience. No unnecessary complexity. Just honest wellness that fits naturally into your lifestyle.
              </p>

              <div className="inline-block px-4 py-1 bg-gold/10 text-gold font-medium rounded-full text-sm tracking-widest uppercase mb-2 mt-8">
                Our Vision
              </div>
              <p className="text-lg text-gray-600 leading-relaxed">
                We dream of a world where Ayurveda is not seen as an alternative, but as a trusted part of everyday living.
                Our vision is to build a wellness brand that helps every generation live healthier, feel better, and find balance in their daily lives through thoughtful, effective, and easy-to-use solutions.
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                We believe MERUVEDA belongs in today’s homes, today’s routines, and today’s lifestyles.
                Because good health shouldn’t be occasional. It should be a way of life.
              </p>
            </div>
            <div className="order-1 md:order-2 relative h-[400px] md:h-[500px] rounded-2xl overflow-hidden shadow-2xl group">
              <Image
                src="/images/ayurvedic_lab_1783843904446.png"
                alt="Ayurvedic Laboratory"
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-playfair font-bold text-deep-purple mb-4">Our Commitment</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">The pillars that define every MeruVeda creation.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Value 1 */}
            <div className="bg-ivory p-10 rounded-2xl border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-2 group">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-6 text-gold group-hover:scale-110 transition-transform duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-deep-purple mb-3">100% Organic</h3>
              <p className="text-gray-600 leading-relaxed text-sm">
                Sustainably sourced directly from ethical farmers. No synthetics, no parabens, just pure earth.
              </p>
            </div>
            
            {/* Value 2 */}
            <div className="bg-ivory p-10 rounded-2xl border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-2 group">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-6 text-gold group-hover:scale-110 transition-transform duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-deep-purple mb-3">Lab Tested</h3>
              <p className="text-gray-600 leading-relaxed text-sm">
                Every batch is rigorously tested in modern facilities to ensure potency, safety, and uncompromising quality.
              </p>
            </div>

            {/* Value 3 */}
            <div className="bg-ivory p-10 rounded-2xl border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-2 group">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-6 text-gold group-hover:scale-110 transition-transform duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-deep-purple mb-3">Cruelty Free</h3>
              <p className="text-gray-600 leading-relaxed text-sm">
                Compassion is at our core. We never test on animals, ensuring our wellness journey harms no living being.
              </p>
            </div>
          </div>
        </div>
      </section>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.8s ease-out forwards;
        }
        .animation-delay-200 {
          animation-delay: 0.2s;
        }
      `}} />
    </div>
  );
}

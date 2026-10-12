import React from "react";
import { Leaf, ShieldCheck, HeartHandshake, Sprout, Flower2, CircleUser, SunMedium, Sparkles } from "lucide-react";
import { Cormorant_Garamond, Outfit } from "next/font/google";

const cormorant = Cormorant_Garamond({ 
  subsets: ["latin"], 
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"]
});

const outfit = Outfit({ 
  subsets: ["latin"], 
  weight: ["300", "400", "500"] 
});

const WhyChooseUs = () => {
  return (
    <section className={`relative py-32 overflow-hidden ${outfit.className}`}>
      {/* Live Video Background */}
      <div className="absolute inset-0 z-0">
        <video 
          autoPlay 
          loop 
          muted 
          playsInline 
          className="w-full h-full object-cover opacity-60"
        >
          {/* Using a beautiful subtle nature/leaf background video */}
          <source src="https://cdn.coverr.co/videos/coverr-sunlight-on-the-leaves-2391/1080p.mp4" type="video/mp4" />
        </video>
        {/* Luxury Overlay to ensure readability and maintain brand colors */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#F9F6F0]/90 via-[#F4ECE3]/80 to-[#F9F6F0]/95 backdrop-blur-[2px]"></div>
      </div>

      {/* Decorative Blur Backgrounds */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-[#E3D5CA] rounded-full mix-blend-multiply filter blur-[120px] opacity-40 animate-pulse z-0"></div>
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-[#DBC6CD] rounded-full mix-blend-multiply filter blur-[150px] opacity-30 z-0"></div>

      {/* Botanical leaf silhouette top-left */}
      <div className="absolute -top-10 -left-10 opacity-[0.05] pointer-events-none transform -rotate-12 scale-[2] z-0">
        <svg width="400" height="400" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 22C12 22 4 16 4 10C4 6 7.5 3 11 3C11.5 3 12 3.2 12 3.2C12 3.2 12.5 3 13 3C16.5 3 20 6 20 10C20 16 12 22 12 22Z" />
        </svg>
      </div>

      <div className="container mx-auto px-6 relative z-10">
        {/* Header Block */}
        <div className="text-center mb-20 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-[#B08D57]"></div>
            <Leaf size={18} className="text-[#B08D57]" strokeWidth={1.5} />
            <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-[#B08D57]"></div>
          </div>
          <p className="uppercase tracking-[0.3em] text-[#A67C52] text-xs font-semibold mb-6">
            The MERUVEDA Difference
          </p>
          <h2 className={`${cormorant.className} text-6xl md:text-7xl font-medium text-[#2C1A2C] mb-6 tracking-tight`}>
            Why MERUVEDA
          </h2>
          <p className="text-[#5A505A] text-lg mb-8 max-w-xl text-center font-light leading-relaxed">
            Rooted in Ayurved. <span className="italic">Crafted for modern lifestyles.</span>
          </p>
          <div className="w-16 h-[1px] bg-[#B08D57]/40"></div>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-24">
          {[
            { title: "Authentic Ayurved", desc: "Timeless Ayurvedic wisdom, beautifully reimagined for the modern era.", Icon: Flower2 },
            { title: "Premium Ingredients", desc: "Sourced thoughtfully with absolute uncompromised purity standards.", Icon: Leaf },
            { title: "Root-Cause Wellness", desc: "Targeting balance and healing from within, for long-term vitality.", Icon: CircleUser },
            { title: "For Modern Life", desc: "Simple, effortless wellness that aligns perfectly with your routine.", Icon: SunMedium },
          ].map((feature, i) => (
            <div
              key={i}
              className="group relative bg-white/40 backdrop-blur-md rounded-3xl p-10 text-center border border-white/60 shadow-[0_8px_32px_rgba(44,26,44,0.04)] hover:shadow-[0_20px_40px_rgba(44,26,44,0.08)] transition-all duration-500 hover:-translate-y-2 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#3D1D3D] to-[#241124] flex items-center justify-center text-[#D4AF37] mb-8 shadow-inner group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                  <feature.Icon size={36} strokeWidth={1} />
                </div>
                
                <h3 className={`${cormorant.className} text-2xl font-semibold text-[#2C1A2C] mb-4`}>
                  {feature.title}
                </h3>
                <p className="text-[#6D636D] text-sm leading-relaxed font-light mb-8">
                  {feature.desc}
                </p>
                <div className="mt-auto">
                  <Sprout size={18} className="text-[#B08D57] opacity-40 group-hover:opacity-100 group-hover:text-[#D4AF37] transition-all duration-500" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust Badges Strip */}
        <div className="relative pt-12">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] bg-gradient-to-r from-transparent via-[#B08D57]/30 to-transparent"></div>
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-12 divide-x-0 lg:divide-x divide-[#B08D57]/10">
            {[
              { label: "Ayurveda, Backed\nBy Science", Icon: Leaf },
              { label: "Lab Tested For\nPurity & Safety", Icon: ShieldCheck },
              { label: "No Harmful\nAdditives", Icon: Sparkles },
              { label: "Made With Care\nIn India", Icon: HeartHandshake },
            ].map((badge, i) => (
              <div
                key={i}
                className="flex flex-col items-center justify-center gap-4 px-6 group"
              >
                <div className="p-3 rounded-full bg-white/50 border border-white/80 shadow-sm group-hover:bg-[#B08D57]/10 transition-colors duration-300">
                  <badge.Icon
                    size={28}
                    className="text-[#B08D57]"
                    strokeWidth={1}
                  />
                </div>
                <span className="uppercase font-medium text-[#2C1A2C] text-[10px] tracking-[0.2em] whitespace-pre-line text-center leading-relaxed">
                  {badge.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhyChooseUs;

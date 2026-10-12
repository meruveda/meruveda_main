import Link from "next/link";
import { ShieldCheck, Package, Heart } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-deep-purple text-ivory py-16 border-t-4 border-gold print:hidden">
      <div className="container mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-12 mb-12">
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo_transparent.svg"
                alt="MERUVEDA WELLNESS"
                className="h-16 w-auto object-contain"
              />
            </Link>
            <p className="text-gray-400 mb-6 max-w-sm">
              Bringing the ancient science of life into the modern world. Authentically crafted Ayurvedic wellness products for your unique constitution.
            </p>
            <div className="flex gap-4 mb-6">
              <a href="https://www.facebook.com/share/1BFx2Bx8fV/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gold transition-colors" aria-label="Facebook">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/>
                </svg>
              </a>
              <a href="https://www.instagram.com/meruveda?igsh=b2RhZ3FoNHJqeWVo" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gold transition-colors" aria-label="Instagram">
                <svg className="w-5 h-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-playfair font-bold text-gold mb-6">Quick Links</h4>
            <ul className="space-y-3 text-gray-400">
              <li><Link href="/products" className="hover:text-gold transition-colors">Shop All Products</Link></li>
              <li><Link href="/track" className="hover:text-gold transition-colors">Track Your Order</Link></li>
              <li><Link href="/about" className="hover:text-gold transition-colors">About MERUVEDA</Link></li>
              <li><Link href="/blog" className="hover:text-gold transition-colors">Ayurvedic Journal</Link></li>
              <li><Link href="/terms" className="hover:text-gold transition-colors">Terms & Conditions</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-playfair font-bold text-gold mb-6">Support</h4>
            <ul className="space-y-3 text-gray-400">
              <li><Link href="/contact" className="hover:text-gold transition-colors">Contact Us</Link></li>
              <li><Link href="/shipping" className="hover:text-gold transition-colors">Shipping Policy</Link></li>
              <li><Link href="/faq" className="hover:text-gold transition-colors">FAQs</Link></li>
              <li><Link href="/privacy" className="hover:text-gold transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>
        
        {/* Trust Badges */}
        <div className="py-8 border-t border-white/10 flex flex-wrap justify-center gap-x-8 gap-y-4">
          {[
            { label: "Secure Payments", icon: <ShieldCheck size={20} className="text-gold" /> },
            { label: "Fast Shipping", icon: <Package size={20} className="text-gold" /> },
            { label: "GMP Certified", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gold"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg> },
            { label: "Lab Tested", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gold"><path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><circle cx="12" cy="13" r="2"/></svg> },
            { label: "Made in India", icon: <Heart size={20} className="text-gold" /> }
          ].map((trust, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm text-gray-300 font-medium">
              {trust.icon}
              <span>{trust.label}</span>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-white/10 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} MERUVEDA Wellness, a brand of Keharsh Enterprises. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

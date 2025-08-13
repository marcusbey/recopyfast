import { Code, Zap, Github, Mail, BookOpen, Shield, Rocket } from "lucide-react";
import Link from "next/link";

const footerLinks = {
  Product: [
    { name: "Features", href: "/#features" },
    { name: "Demo", href: "/demo" },
    { name: "Documentation", href: "/docs" }
  ],
  Company: [
    { name: "Blog", href: "/blog" },
    { name: "GitHub", href: "https://github.com/marcusbey/recopyfast" }
  ],
  Legal: [
    { name: "Privacy Policy", href: "/privacy" },
    { name: "Terms of Service", href: "/terms" }
  ]
};

const socialLinks = [
  { 
    icon: Github, 
    href: "https://github.com/marcusbey/recopyfast", 
    label: "GitHub",
    color: "hover:bg-gray-700"
  },
  { 
    icon: Mail, 
    href: "mailto:hello@recopyfast.com", 
    label: "Email",
    color: "hover:bg-blue-600"
  }
];

const quickFeatures = [
  { icon: Rocket, text: "One-line integration" },
  { icon: Shield, text: "Secure & lightweight" },
  { icon: BookOpen, text: "Comprehensive docs" }
];

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Brand Section */}
          <div className="md:col-span-2 lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Code className="h-6 w-6 text-white" />
                </div>
                <Zap className="h-4 w-4 text-yellow-400 absolute -top-1 -right-1" />
              </div>
              <span className="text-2xl font-bold tracking-tight">ReCopyFast</span>
            </div>
            
            <p className="text-gray-300 mb-8 max-w-md leading-relaxed">
              Transform any website into an intelligent content management platform 
              with a single script tag. No backend changes required.
            </p>

            {/* Quick Features */}
            <div className="space-y-3 mb-8">
              {quickFeatures.map((feature, index) => (
                <div key={index} className="flex items-center space-x-3">
                  <feature.icon className="h-4 w-4 text-blue-400" />
                  <span className="text-gray-300 text-sm">{feature.text}</span>
                </div>
              ))}
            </div>
            
            {/* Social Links */}
            <div className="flex space-x-3">
              {socialLinks.map((social, index) => (
                <a
                  key={index}
                  href={social.href}
                  className={`w-11 h-11 bg-gray-800 rounded-xl flex items-center justify-center ${social.color} transition-all duration-200 hover:scale-105`}
                  aria-label={social.label}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <social.icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Link Sections */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category} className="lg:col-span-1">
              <h3 className="text-lg font-semibold mb-6 text-white">{category}</h3>
              <ul className="space-y-4">
                {links.map((link, index) => (
                  <li key={index}>
                    {link.href.startsWith('http') ? (
                      <a
                        href={link.href}
                        className="text-gray-400 hover:text-blue-400 transition-colors duration-200 text-sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.name}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-gray-400 hover:text-blue-400 transition-colors duration-200 text-sm"
                      >
                        {link.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Newsletter Section */}
        <div className="border-t border-gray-800 mt-16 pt-12">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="text-xl font-semibold mb-3">Stay updated</h3>
              <p className="text-gray-400 text-sm">
                Get the latest updates, tutorials, and product announcements.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 whitespace-nowrap">
                Subscribe
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
          <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6 mb-4 md:mb-0">
            <p className="text-gray-400 text-sm">
              © 2024 ReCopyFast. All rights reserved.
            </p>
            <span className="text-gray-500 text-sm">Made with ❤️ for developers</span>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-gray-400">All systems operational</span>
            </div>
            <div className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full">
              v1.0.0
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
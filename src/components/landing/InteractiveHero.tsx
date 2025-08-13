'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, Sparkles, CheckCircle, ArrowRight, ChevronLeft, ChevronRight, Utensils, Car, Coffee } from 'lucide-react';

interface EditableText {
  id: string;
  text: string;
  isEditing: boolean;
  originalText: string;
}

interface DemoSite {
  id: string;
  name: string;
  theme: string;
  icon: React.ElementType;
  background: string;
  textColor: string;
  accentColor: string;
  editableTexts: EditableText[];
}

const demoSites: DemoSite[] = [
  {
    id: 'restaurant',
    name: 'Bella Vista Restaurant',
    theme: 'restaurant',
    icon: Utensils,
    background: 'bg-gradient-to-br from-amber-50 to-orange-50',
    textColor: 'text-amber-900',
    accentColor: 'from-amber-600 to-orange-600',
    editableTexts: [
      {
        id: 'headline',
        text: 'Authentic Italian Cuisine',
        isEditing: false,
        originalText: 'Authentic Italian Cuisine'
      },
      {
        id: 'subheading',
        text: 'Experience the finest Italian dishes made with fresh, locally-sourced ingredients in the heart of downtown.',
        isEditing: false,
        originalText: 'Experience the finest Italian dishes made with fresh, locally-sourced ingredients in the heart of downtown.'
      },
      {
        id: 'cta',
        text: 'Book Your Table',
        isEditing: false,
        originalText: 'Book Your Table'
      },
      {
        id: 'about-title',
        text: 'Our Story',
        isEditing: false,
        originalText: 'Our Story'
      },
      {
        id: 'about-text',
        text: 'Founded in 1952 by the Rossi family, Bella Vista has been serving authentic Italian cuisine for three generations. Our chefs bring traditional recipes from Sicily and Tuscany to your table.',
        isEditing: false,
        originalText: 'Founded in 1952 by the Rossi family, Bella Vista has been serving authentic Italian cuisine for three generations. Our chefs bring traditional recipes from Sicily and Tuscany to your table.'
      },
      {
        id: 'menu-title',
        text: 'Today\'s Specials',
        isEditing: false,
        originalText: 'Today\'s Specials'
      },
      {
        id: 'special-1',
        text: 'Truffle Risotto with Wild Mushrooms - $28',
        isEditing: false,
        originalText: 'Truffle Risotto with Wild Mushrooms - $28'
      },
      {
        id: 'special-2',
        text: 'Osso Buco alla Milanese - $32',
        isEditing: false,
        originalText: 'Osso Buco alla Milanese - $32'
      }
    ]
  },
  {
    id: 'carwash',
    name: 'Premium Auto Spa',
    theme: 'carwash',
    icon: Car,
    background: 'bg-gradient-to-br from-blue-50 to-cyan-50',
    textColor: 'text-blue-900',
    accentColor: 'from-blue-600 to-cyan-600',
    editableTexts: [
      {
        id: 'headline',
        text: 'Premium Car Detailing',
        isEditing: false,
        originalText: 'Premium Car Detailing'
      },
      {
        id: 'subheading',
        text: 'Professional car wash and detailing services that make your vehicle shine like new with eco-friendly products.',
        isEditing: false,
        originalText: 'Professional car wash and detailing services that make your vehicle shine like new with eco-friendly products.'
      },
      {
        id: 'cta',
        text: 'Schedule Service',
        isEditing: false,
        originalText: 'Schedule Service'
      },
      {
        id: 'services-title',
        text: 'Our Services',
        isEditing: false,
        originalText: 'Our Services'
      },
      {
        id: 'service-desc',
        text: 'From basic washes to full ceramic coating, we offer comprehensive automotive care services. All work comes with our 100% satisfaction guarantee.',
        isEditing: false,
        originalText: 'From basic washes to full ceramic coating, we offer comprehensive automotive care services. All work comes with our 100% satisfaction guarantee.'
      },
      {
        id: 'pricing-title',
        text: 'Service Packages',
        isEditing: false,
        originalText: 'Service Packages'
      },
      {
        id: 'package-1',
        text: 'Express Wash - Interior vacuum, exterior wash - $25',
        isEditing: false,
        originalText: 'Express Wash - Interior vacuum, exterior wash - $25'
      },
      {
        id: 'package-2',
        text: 'Premium Detail - Full detail, wax, tire shine - $85',
        isEditing: false,
        originalText: 'Premium Detail - Full detail, wax, tire shine - $85'
      }
    ]
  },
  {
    id: 'bakery',
    name: 'Sweet Dreams Bakery',
    theme: 'bakery',
    icon: Coffee,
    background: 'bg-gradient-to-br from-pink-50 to-rose-50',
    textColor: 'text-rose-900',
    accentColor: 'from-pink-600 to-rose-600',
    editableTexts: [
      {
        id: 'headline',
        text: 'Freshly Baked Daily',
        isEditing: false,
        originalText: 'Freshly Baked Daily'
      },
      {
        id: 'subheading',
        text: 'Artisan breads, pastries, and cakes made with love and the finest ingredients since 1985.',
        isEditing: false,
        originalText: 'Artisan breads, pastries, and cakes made with love and the finest ingredients since 1985.'
      },
      {
        id: 'cta',
        text: 'Order Online',
        isEditing: false,
        originalText: 'Order Online'
      },
      {
        id: 'tradition-title',
        text: 'Family Tradition',
        isEditing: false,
        originalText: 'Family Tradition'
      },
      {
        id: 'tradition-text',
        text: 'Three generations of baking expertise brings you authentic European recipes. Every loaf, pastry, and cake is made from scratch using traditional methods.',
        isEditing: false,
        originalText: 'Three generations of baking expertise brings you authentic European recipes. Every loaf, pastry, and cake is made from scratch using traditional methods.'
      },
      {
        id: 'hours-title',
        text: 'Visit Us Today',
        isEditing: false,
        originalText: 'Visit Us Today'
      },
      {
        id: 'hours-1',
        text: 'Monday - Friday: 6:00 AM - 7:00 PM',
        isEditing: false,
        originalText: 'Monday - Friday: 6:00 AM - 7:00 PM'
      },
      {
        id: 'hours-2',
        text: 'Saturday - Sunday: 7:00 AM - 6:00 PM',
        isEditing: false,
        originalText: 'Saturday - Sunday: 7:00 AM - 6:00 PM'
      }
    ]
  }
];

export default function InteractiveHero() {
  const [currentSite, setCurrentSite] = useState(0);
  const [editableTexts, setEditableTexts] = useState<EditableText[]>(demoSites[0].editableTexts);

  const [isAutoDemo, setIsAutoDemo] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

  const currentSiteData = demoSites[currentSite];

  const nextSite = () => {
    const newSiteIndex = (currentSite + 1) % demoSites.length;
    setCurrentSite(newSiteIndex);
    setEditableTexts(demoSites[newSiteIndex].editableTexts);
  };

  const prevSite = () => {
    const newSiteIndex = (currentSite - 1 + demoSites.length) % demoSites.length;
    setCurrentSite(newSiteIndex);
    setEditableTexts(demoSites[newSiteIndex].editableTexts);
  };

  const handleTextClick = (id: string) => {
    setEditableTexts(prev =>
      prev.map(item =>
        item.id === id ? { ...item, isEditing: true } : { ...item, isEditing: false }
      )
    );
  };

  const handleTextChange = (id: string, newText: string) => {
    setEditableTexts(prev =>
      prev.map(item =>
        item.id === id ? { ...item, text: newText } : item
      )
    );
  };

  const handleTextSave = (id: string) => {
    setEditableTexts(prev =>
      prev.map(item =>
        item.id === id ? { ...item, isEditing: false } : item
      )
    );
    
    // Show success animation
    setShowSuccessAnimation(true);
    setTimeout(() => setShowSuccessAnimation(false), 2000);
  };

  const handleKeyPress = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleTextSave(id);
    }
    if (e.key === 'Escape') {
      // Reset to original text
      setEditableTexts(prev =>
        prev.map(item =>
          item.id === id 
            ? { ...item, text: item.originalText, isEditing: false }
            : item
        )
      );
    }
  };

  const runAutoDemo = () => {
    setIsAutoDemo(true);
    const demoSequence = [
      { id: 'headline', newText: 'Transform Any Website Instantly', delay: 1000 },
      { id: 'subheading', newText: 'AI-powered content editing with real-time collaboration.', delay: 2000 },
      { id: 'cta', newText: 'Try AI Magic Now', delay: 3000 }
    ];

    demoSequence.forEach(({ id, newText, delay }) => {
      setTimeout(() => {
        setEditableTexts(prev =>
          prev.map(item =>
            item.id === id ? { ...item, text: newText, isEditing: true } : item
          )
        );
        
        setTimeout(() => {
          setEditableTexts(prev =>
            prev.map(item =>
              item.id === id ? { ...item, isEditing: false } : item
            )
          );
          setShowSuccessAnimation(true);
          setTimeout(() => setShowSuccessAnimation(false), 500);
        }, 800);
      }, delay);
    });

    setTimeout(() => setIsAutoDemo(false), 5000);
  };

  const EditableTextComponent = ({ item }: { item: EditableText }) => {
    if (item.isEditing) {
      return (
        <motion.div
          initial={{ scale: 1.02, boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.5)' }}
          animate={{ scale: 1.02, boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.5)' }}
          className="relative"
        >
          <input
            type="text"
            value={item.text}
            onChange={(e) => handleTextChange(item.id, e.target.value)}
            onBlur={() => handleTextSave(item.id)}
            onKeyDown={(e) => handleKeyPress(e, item.id)}
            className={`bg-white/90 border-2 border-blue-500 rounded-xl px-4 py-3 outline-none shadow-lg w-full ${
              item.id === 'headline' 
                ? `text-4xl md:text-5xl lg:text-6xl font-bold ${currentSiteData.textColor} text-center`
                : item.id === 'subheading'
                ? `text-lg md:text-xl ${currentSiteData.textColor} text-center`
                : item.id === 'cta'
                ? `text-lg font-semibold ${currentSiteData.textColor} text-center`
                : item.id.includes('title')
                ? `text-2xl md:text-3xl font-bold ${currentSiteData.textColor}`
                : `text-base md:text-lg ${currentSiteData.textColor}`
            }`}
            autoFocus
          />
          <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white text-xs px-3 py-1 rounded-lg shadow-lg">
            Press Enter to save, Esc to cancel
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        onClick={() => handleTextClick(item.id)}
        className={`cursor-pointer hover:bg-white/20 rounded-xl p-3 transition-all duration-200 relative group ${
          item.id === 'headline' 
            ? `text-4xl md:text-5xl lg:text-6xl font-bold ${currentSiteData.textColor}`
            : item.id === 'subheading'
            ? `text-lg md:text-xl ${currentSiteData.textColor} opacity-90`
            : item.id === 'cta'
            ? `bg-gradient-to-r ${currentSiteData.accentColor} text-white px-8 py-3 text-lg rounded-xl font-semibold shadow-lg hover:shadow-xl`
            : item.id.includes('title')
            ? `text-2xl md:text-3xl font-bold ${currentSiteData.textColor} mb-4`
            : `text-base md:text-lg ${currentSiteData.textColor} opacity-80`
        }`}
      >
        {item.text}
        <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 text-white text-xs px-3 py-1 rounded-lg shadow-lg whitespace-nowrap z-10">
          Click to edit
        </div>
        {item.id !== 'cta' && (
          <div className="absolute -top-3 -right-3 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
            <Wand2 className="w-3 h-3 text-white" />
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="relative">
      {/* Success Animation Overlay */}
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2"
          >
            <CheckCircle className="w-5 h-5" />
            Content updated instantly!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Demo Site Navigation */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-4">
          {demoSites.map((site, index) => {
            const Icon = site.icon;
            return (
              <button
                key={site.id}
                onClick={() => {
                  setCurrentSite(index);
                  setEditableTexts(site.editableTexts);
                }}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-300 ${
                  currentSite === index 
                    ? `bg-gradient-to-r ${site.accentColor} text-white shadow-lg scale-105` 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{site.name}</span>
              </button>
            );
          })}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={prevSite}
            className="p-2 rounded-full bg-white shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={nextSite}
            className="p-2 rounded-full bg-white shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Demo Website Container */}
      <motion.div
        key={currentSite}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className={`${currentSiteData.background} rounded-2xl shadow-2xl border border-white/50 overflow-hidden`}
      >
        {/* Browser Chrome */}
        <div className="bg-gray-800 px-6 py-3 flex items-center space-x-2">
          <div className="flex space-x-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          </div>
          <div className="flex-1 bg-gray-700 rounded-lg px-4 py-1 mx-4">
            <span className="text-gray-300 text-sm">https://{currentSiteData.name.toLowerCase().replace(/\s+/g, '')}.com</span>
          </div>
          <div className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded-lg animate-pulse">
            ReCopyFast Active
          </div>
        </div>

        {/* Demo Website Content */}
        <div className={`p-12 min-h-[700px] max-h-[700px] overflow-y-auto ${currentSiteData.textColor}`}>
          <div className="text-center space-y-8 max-w-4xl mx-auto">
            {/* Main Headline */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <EditableTextComponent item={editableTexts.find(item => item.id === 'headline')!} />
            </motion.div>

            {/* Subheading */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="max-w-2xl mx-auto"
            >
              <EditableTextComponent item={editableTexts.find(item => item.id === 'subheading')!} />
            </motion.div>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-8"
            >
              <EditableTextComponent item={editableTexts.find(item => item.id === 'cta')!} />
              
              <button className={`border-2 border-current px-8 py-3 rounded-xl hover:bg-current hover:text-white transition-all flex items-center gap-2 text-lg font-semibold ${currentSiteData.textColor}`}>
                Learn More
                <ArrowRight className="w-5 h-5" />
              </button>
            </motion.div>

            {/* Additional Content Sections */}
            <div className="mt-16 space-y-12">
              {/* About/Services Section */}
              <div className="text-center space-y-6">
                <EditableTextComponent item={editableTexts.find(item => item.id.includes('about-title') || item.id.includes('services-title') || item.id.includes('tradition-title'))!} />
                <EditableTextComponent item={editableTexts.find(item => item.id.includes('about-text') || item.id.includes('service-desc') || item.id.includes('tradition-text'))!} />
              </div>

              {/* Menu/Pricing/Hours Section */}
              <div className="text-center space-y-6">
                <EditableTextComponent item={editableTexts.find(item => item.id.includes('menu-title') || item.id.includes('pricing-title') || item.id.includes('hours-title'))!} />
                <div className="space-y-4">
                  <EditableTextComponent item={editableTexts.find(item => item.id.includes('special-1') || item.id.includes('package-1') || item.id.includes('hours-1'))!} />
                  <EditableTextComponent item={editableTexts.find(item => item.id.includes('special-2') || item.id.includes('package-2') || item.id.includes('hours-2'))!} />
                </div>
              </div>
            </div>

            {/* Demo Features - themed content */}
            <div className="grid md:grid-cols-3 gap-6 pt-12 mt-16 border-t border-current/20">
              {currentSiteData.theme === 'restaurant' && (
                <>
                  <div className="text-center">
                    <div className="text-3xl mb-2">🍝</div>
                    <h4 className="font-semibold mb-2">Fresh Pasta</h4>
                    <p className="text-sm opacity-80">Made daily with authentic Italian recipes</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-2">🍷</div>
                    <h4 className="font-semibold mb-2">Fine Wine</h4>
                    <p className="text-sm opacity-80">Curated selection from Italian vineyards</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-2">👨‍🍳</div>
                    <h4 className="font-semibold mb-2">Expert Chefs</h4>
                    <p className="text-sm opacity-80">Trained in traditional Italian techniques</p>
                  </div>
                </>
              )}
              
              {currentSiteData.theme === 'carwash' && (
                <>
                  <div className="text-center">
                    <div className="text-3xl mb-2">✨</div>
                    <h4 className="font-semibold mb-2">Premium Wash</h4>
                    <p className="text-sm opacity-80">Complete exterior and interior cleaning</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-2">🛡️</div>
                    <h4 className="font-semibold mb-2">Paint Protection</h4>
                    <p className="text-sm opacity-80">Advanced ceramic coating available</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-2">⚡</div>
                    <h4 className="font-semibold mb-2">Quick Service</h4>
                    <p className="text-sm opacity-80">Professional results in 30 minutes</p>
                  </div>
                </>
              )}
              
              {currentSiteData.theme === 'bakery' && (
                <>
                  <div className="text-center">
                    <div className="text-3xl mb-2">🥐</div>
                    <h4 className="font-semibold mb-2">Artisan Breads</h4>
                    <p className="text-sm opacity-80">Handcrafted with organic ingredients</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-2">🎂</div>
                    <h4 className="font-semibold mb-2">Custom Cakes</h4>
                    <p className="text-sm opacity-80">Perfect for any special occasion</p>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl mb-2">☕</div>
                    <h4 className="font-semibold mb-2">Fresh Coffee</h4>
                    <p className="text-sm opacity-80">Premium roasts brewed to perfection</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Demo Instructions */}
      <div className="mt-8 text-center">
        <div className="inline-flex items-center px-4 py-2 rounded-full bg-gray-100 text-gray-700 text-sm">
          <Sparkles className="w-4 h-4 mr-2 text-blue-600" />
          Click any text above to edit it instantly
        </div>
      </div>

    </div>
  );
}
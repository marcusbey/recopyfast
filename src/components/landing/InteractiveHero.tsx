'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, Sparkles, CheckCircle, ArrowRight, ChevronLeft, ChevronRight, Utensils, Car, Coffee, Edit3, Save, X, Image, Code, Zap } from 'lucide-react';
import { DEFAULT_EDITING_RULES, getTextEditingStyles, generateUnsplashUrl, TEXT_EDITING_CONSISTENCY_RULES } from '@/lib/editingRules';

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
      },
      {
        id: 'feature-1-title',
        text: 'Fresh Pasta',
        isEditing: false,
        originalText: 'Fresh Pasta'
      },
      {
        id: 'feature-1-desc',
        text: 'Made daily with authentic Italian recipes',
        isEditing: false,
        originalText: 'Made daily with authentic Italian recipes'
      },
      {
        id: 'feature-2-title',
        text: 'Fine Wine',
        isEditing: false,
        originalText: 'Fine Wine'
      },
      {
        id: 'feature-2-desc',
        text: 'Curated selection from Italian vineyards',
        isEditing: false,
        originalText: 'Curated selection from Italian vineyards'
      },
      {
        id: 'learn-more-btn',
        text: 'Learn More',
        isEditing: false,
        originalText: 'Learn More'
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
      },
      // Additional Car Wash Service Cards
      {
        id: 'basic-wash-title',
        text: 'Basic Wash',
        isEditing: false,
        originalText: 'Basic Wash'
      },
      {
        id: 'basic-wash-desc',
        text: 'Quick exterior wash with tire shine',
        isEditing: false,
        originalText: 'Quick exterior wash with tire shine'
      },
      {
        id: 'premium-detail-title',
        text: 'Premium Detail',
        isEditing: false,
        originalText: 'Premium Detail'
      },
      {
        id: 'premium-detail-desc',
        text: 'Full interior & exterior detailing',
        isEditing: false,
        originalText: 'Full interior & exterior detailing'
      },
      {
        id: 'ceramic-coating-title',
        text: 'Ceramic Coating',
        isEditing: false,
        originalText: 'Ceramic Coating'
      },
      {
        id: 'ceramic-coating-desc',
        text: 'Long-lasting paint protection',
        isEditing: false,
        originalText: 'Long-lasting paint protection'
      },
      {
        id: 'satisfaction-title',
        text: '100% Satisfaction',
        isEditing: false,
        originalText: '100% Satisfaction'
      },
      {
        id: 'satisfaction-subtitle',
        text: 'Guaranteed',
        isEditing: false,
        originalText: 'Guaranteed'
      },
      {
        id: 'view-pricing-btn',
        text: 'View Pricing',
        isEditing: false,
        originalText: 'View Pricing'
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
      },
      // Contact Information
      {
        id: 'contact-address',
        text: '📍 123 Main Street, Downtown',
        isEditing: false,
        originalText: '📍 123 Main Street, Downtown'
      },
      {
        id: 'contact-phone',
        text: '📞 (555) 123-4567',
        isEditing: false,
        originalText: '📞 (555) 123-4567'
      }
    ]
  }
];

export default function InteractiveHero() {
  const [currentSite, setCurrentSite] = useState(0);
  const [editableTexts, setEditableTexts] = useState<EditableText[]>(demoSites[0].editableTexts);

  const [isAutoDemo, setIsAutoDemo] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [showDemoWidget, setShowDemoWidget] = useState(false);

  const currentSiteData = demoSites[currentSite];

  // Function to determine text color based on theme and context
  const getTextColor = (elementId: string) => {
    const theme = currentSiteData.theme;
    
    // Hero section elements (headline, subheading on hero backgrounds)
    if (elementId === 'headline' || elementId === 'subheading') {
      if (theme === 'restaurant') {
        return 'text-white'; // White text on dark restaurant hero
      } else if (theme === 'carwash') {
        return 'text-white'; // White text on blue gradient hero
      } else if (theme === 'bakery') {
        return 'text-rose-900'; // Dark text on light pink background
      }
    }
    
    // Title elements in content sections
    if (elementId.includes('title')) {
      if (theme === 'restaurant') {
        return 'text-amber-900'; // Dark amber on light backgrounds
      } else if (theme === 'carwash') {
        return 'text-gray-900'; // Dark text on light backgrounds
      } else if (theme === 'bakery') {
        return 'text-rose-900'; // Dark rose on light backgrounds
      }
    }
    
    // Body text elements
    if (theme === 'restaurant') {
      return 'text-amber-800';
    } else if (theme === 'carwash') {
      return 'text-gray-700';
    } else if (theme === 'bakery') {
      return 'text-rose-800';
    }
    
    return 'text-gray-800'; // Default fallback
  };

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

  const EditableImageComponent = ({ src, alt, className, imageType }: { src: string, alt: string, className: string, imageType: string }) => {
    const [isHovering, setIsHovering] = useState(false);
    const [showImageModal, setShowImageModal] = useState(false);
    const [imagePrompt, setImagePrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [currentImageSrc, setCurrentImageSrc] = useState(src);
    
    const handleImageReplace = (newSrc: string) => {
      // Animate image replacement with smooth transition
      const imgElement = document.querySelector(`img[src="${currentImageSrc}"]`) as HTMLImageElement;
      if (imgElement) {
        // Create smooth fade transition
        imgElement.style.transition = 'opacity 0.4s ease, transform 0.4s ease, box-shadow 0.4s ease';
        imgElement.style.opacity = '0';
        imgElement.style.transform = 'scale(0.95) rotateY(10deg)';
        
        setTimeout(() => {
          imgElement.src = newSrc;
          imgElement.style.opacity = '1';
          imgElement.style.transform = 'scale(1) rotateY(0deg)';
          
          // Add success animation effect with green glow
          imgElement.style.boxShadow = '0 0 40px rgba(16, 185, 129, 0.6), 0 0 80px rgba(16, 185, 129, 0.3)';
          setTimeout(() => {
            imgElement.style.boxShadow = '';
          }, 1500);
        }, 400);
      }
      
      setCurrentImageSrc(newSrc);
      setShowImageModal(false);
      setImagePrompt('');
      setShowSuccessAnimation(true);
      setTimeout(() => setShowSuccessAnimation(false), 3000);
    };

    const generateRandomImage = () => {
      const dimensions = imageType === 'hero' ? '1200x600' : '800x600';
      const newImage = generateUnsplashUrl(imageType as any, 800, 600);
      handleImageReplace(newImage);
    };

    const generateFromPrompt = async () => {
      if (!imagePrompt.trim()) return;
      
      setIsGenerating(true);
      try {
        // For demo purposes, generate a themed Unsplash URL based on prompt keywords
        const keywords = imagePrompt.toLowerCase();
        let category = imageType;
        
        if (keywords.includes('food') || keywords.includes('dish') || keywords.includes('meal')) {
          category = 'food';
        } else if (keywords.includes('car') || keywords.includes('vehicle') || keywords.includes('auto')) {
          category = 'car';  
        } else if (keywords.includes('bakery') || keywords.includes('bread') || keywords.includes('cake')) {
          category = 'bakery';
        }
        
        // Create a more specific URL with prompt keywords
        const promptFormatted = imagePrompt.replace(/\s+/g, ',');
        const dimensions = imageType === 'hero' ? '1200x600' : '800x600';
        const newImage = `https://source.unsplash.com/${dimensions}/?${promptFormatted}&${Date.now()}`;
        
        handleImageReplace(newImage);
      } catch (error) {
        console.error('Error generating image:', error);
        // Fallback to random image
        generateRandomImage();
      } finally {
        setIsGenerating(false);
      }
    };
    
    return (
      <>
        <div 
          className="relative group overflow-visible"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <motion.img 
            src={currentImageSrc} 
            alt={alt} 
            className={`${className} transition-all duration-500 group-hover:scale-105 group-hover:shadow-2xl hover:brightness-110`}
            whileHover={{ 
              scale: 1.05, 
              rotateY: 5,
              rotateX: 2,
              filter: "brightness(1.1)"
            }}
            whileTap={{ scale: 0.98 }}
            transition={{ 
              type: "spring", 
              stiffness: 400, 
              damping: 20,
              duration: 0.3
            }}
            style={{
              transformStyle: "preserve-3d",
              backfaceVisibility: "hidden"
            }}
          />
          
          {isHovering && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, backdropFilter: "blur(0px)" }}
              animate={{ 
                opacity: 1, 
                scale: 1, 
                backdropFilter: "blur(4px)"
              }}
              exit={{ 
                opacity: 0, 
                scale: 0.9, 
                backdropFilter: "blur(0px)"
              }}
              className="absolute inset-0 bg-gradient-to-t from-black/70 via-purple/10 to-transparent flex items-center justify-center cursor-pointer rounded-lg backdrop-blur-sm"
              onClick={() => setShowImageModal(true)}
              whileHover={{ 
                background: "linear-gradient(to top, rgba(0,0,0,0.8), rgba(147,51,234,0.2), transparent)"
              }}
              transition={{ duration: 0.3 }}
            >
              <motion.div 
                className="bg-white/95 backdrop-blur-sm text-gray-900 px-6 py-3 rounded-xl flex items-center gap-3 hover:bg-white transition-all shadow-lg border border-white/20"
                whileHover={{ 
                  scale: 1.08, 
                  y: -4,
                  boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
                  background: "rgba(255,255,255,0.98)"
                }}
                whileTap={{ scale: 0.95 }}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ 
                  type: "spring", 
                  stiffness: 400, 
                  damping: 15,
                  delay: 0.1
                }}
              >
                <motion.div 
                  className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg flex items-center justify-center"
                  whileHover={{ 
                    rotate: 360,
                    background: "linear-gradient(45deg, #8b5cf6, #06b6d4)"
                  }}
                  transition={{ duration: 0.6 }}
                >
                  <Image className="w-4 h-4 text-white" />
                </motion.div>
                <span className="font-medium">Edit Image</span>
                <div className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                  AI Powered
                </div>
              </motion.div>
            </motion.div>
          )}
        </div>

        {/* Image Editing Modal */}
        <AnimatePresence>
          {showImageModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
              onClick={() => setShowImageModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl p-8 max-w-lg w-full mx-4 shadow-2xl backdrop-blur-sm border border-gray-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl flex items-center justify-center">
                      <Image className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Edit Image</h3>
                      <p className="text-sm text-gray-500">AI-powered image generation</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowImageModal(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Current Image Preview */}
                <div className="mb-8 relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  <img 
                    src={currentImageSrc} 
                    alt={alt} 
                    className="w-full h-auto max-h-48 object-contain" 
                  />
                  <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                    Current
                  </div>
                </div>

                {/* Prompt Input */}
                <div className="mb-8">
                  <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    Describe your perfect image:
                  </label>
                  <textarea
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder={`e.g., "modern luxury car with city lights", "fresh homemade pasta on marble counter", "rustic artisan bread with steam"`}
                    className="w-full p-4 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all bg-gray-50 focus:bg-white"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500 mt-2">💡 Tip: Be specific about style, mood, and details for better results</p>
                </div>

                {/* Action Buttons */}
                <div className="space-y-4">
                  <motion.button
                    onClick={generateFromPrompt}
                    disabled={!imagePrompt.trim() || isGenerating}
                    className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white py-4 px-6 rounded-xl font-semibold hover:shadow-lg hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-3 text-sm"
                    whileHover={{ scale: !isGenerating && imagePrompt.trim() ? 1.02 : 1 }}
                    whileTap={{ scale: !isGenerating && imagePrompt.trim() ? 0.98 : 1 }}
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Creating your image...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>✨ Generate with AI</span>
                        <div className="ml-auto bg-white/20 px-2 py-1 rounded-full text-xs">
                          Free
                        </div>
                      </>
                    )}
                  </motion.button>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <motion.button
                      onClick={generateRandomImage}
                      className="py-3 px-4 border-2 border-gray-200 text-gray-700 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all text-sm font-medium flex items-center justify-center gap-2"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <span className="text-lg">🎲</span>
                      Surprise Me
                    </motion.button>
                    
                    <motion.button
                      onClick={() => setShowImageModal(false)}
                      className="py-3 px-4 border-2 border-gray-200 text-gray-700 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all text-sm font-medium"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Cancel
                    </motion.button>
                  </div>
                </div>

                <p className="text-xs text-gray-500 mt-4 text-center">
                  Images are generated using Unsplash for demo purposes
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  };

  const EditableTextComponent = ({ item }: { item: EditableText }) => {
    const elementRef = useRef<HTMLDivElement>(null);
    
    // Get the original element's computed styles to preserve them exactly
    useEffect(() => {
      if (item.isEditing && elementRef.current) {
        // Find the original element that was clicked to get its exact styles
        const originalElement = document.querySelector(`[data-editable-id="${item.id}"]`) as HTMLElement;
        if (originalElement) {
          const preservedStyles = getTextEditingStyles(originalElement);
          Object.assign(elementRef.current.style, preservedStyles);
        }
      }
    }, [item.id, item.isEditing]);
    
    if (item.isEditing) {
      // Determine if this should be a textarea (for longer content) or input (for short content)
      const useTextarea = item.text.length > 50 || item.text.includes('\n') || item.id === 'subheading' || item.id.includes('text') || item.id.includes('desc');
      
      return (
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: 1 }}
          className="relative"
          ref={elementRef}
          data-editing-mode="true"
        >
        {useTextarea ? (
          <textarea
            value={item.text}
            onChange={(e) => handleTextChange(item.id, e.target.value)}
            onBlur={() => handleTextSave(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditableTexts(prev =>
                  prev.map(textItem =>
                    textItem.id === item.id 
                      ? { ...textItem, text: textItem.originalText, isEditing: false }
                      : textItem
                  )
                );
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                handleTextSave(item.id);
              }
            }}
            className="w-full outline-none resize-none"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0',
              margin: '0',
              fontSize: 'inherit',
              fontFamily: 'inherit',
              fontWeight: 'inherit',
              fontStyle: 'inherit',
              lineHeight: 'inherit',
              letterSpacing: 'inherit',
              textAlign: 'inherit',
              textDecoration: 'inherit',
              textTransform: 'inherit',
              color: 'inherit',
              width: '100%',
              minHeight: 'auto',
              height: 'auto',
              overflow: 'visible',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'pre-wrap'
            }}
            rows={Math.max(1, item.text.split('\n').length)}
            autoFocus
          />
        ) : (
          <input
            type="text"
            value={item.text}
            onChange={(e) => handleTextChange(item.id, e.target.value)}
            onBlur={() => handleTextSave(item.id)}
            onKeyDown={(e) => handleKeyPress(e, item.id)}
            className="w-full outline-none"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0',
              margin: '0',
              fontSize: 'inherit',
              fontFamily: 'inherit',
              fontWeight: 'inherit',
              fontStyle: 'inherit',
              lineHeight: 'inherit',
              letterSpacing: 'inherit',
              textAlign: 'inherit',
              textDecoration: 'inherit',
              textTransform: 'inherit',
              color: 'inherit',
              width: '100%',
              wordWrap: 'break-word',
              overflowWrap: 'break-word'
            }}
            autoFocus
          />
        )}
        
          {/* Action buttons */}
          <div className="absolute -top-16 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg">
            <button
              onClick={() => handleTextSave(item.id)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded transition-colors"
            >
              <Save className="w-3 h-3" />
              Save
            </button>
            <div className="w-px h-4 bg-gray-200" />
            <button
              onClick={() => {
                // AI suggestion placeholder - could integrate with OpenAI
                const suggestions = {
                  'headline': ['AI-Powered Content Management', 'Transform Websites Instantly', 'Smart Website Editing'],
                  'subheading': ['Make any website editable with our powerful AI-driven platform.', 'Revolutionary content management that works with any website.', 'Transform static sites into dynamic, editable experiences.']
                };
                const suggestion = suggestions[item.id as keyof typeof suggestions]?.[0];
                if (suggestion) {
                  handleTextChange(item.id, suggestion);
                }
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              AI
            </button>
            <div className="w-px h-4 bg-gray-200" />
            <button
              onClick={() => {
                setEditableTexts(prev =>
                  prev.map(textItem =>
                    textItem.id === item.id 
                      ? { ...textItem, text: textItem.originalText, isEditing: false }
                      : textItem
                  )
                );
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded transition-colors"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </div>
          
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-3 py-1 rounded-lg whitespace-nowrap">
            {useTextarea ? 'Ctrl+Enter to save, Esc to cancel' : 'Enter to save, Esc to cancel'}
          </div>
        </motion.div>
      );
    }

    return (
      <div
        onClick={() => handleTextClick(item.id)}
        data-editable-id={item.id}
        className={`cursor-pointer rounded-xl p-3 transition-all duration-200 relative group border-2 border-transparent hover:border-dashed hover:border-blue-400 ${
          item.id === 'headline' 
            ? `text-4xl md:text-5xl lg:text-6xl font-bold ${getTextColor(item.id)}`
            : item.id === 'subheading'
            ? `text-lg md:text-xl opacity-90 ${getTextColor(item.id)}`
            : item.id === 'cta'
            ? `bg-gradient-to-r ${currentSiteData.accentColor} text-white px-8 py-3 text-lg rounded-xl font-semibold shadow-lg hover:shadow-xl inline-block hover:border-transparent`
            : item.id.includes('title')
            ? `text-2xl md:text-3xl font-bold mb-4 text-left ${getTextColor(item.id)}`
            : `text-base md:text-lg opacity-80 text-left ${getTextColor(item.id)}`
        }`}
      >
        {/* Preserve formatting for multi-line content */}
        {item.text.split('\n').map((line, index) => (
          <div key={index} className={index > 0 ? 'mt-2' : ''}>
            {line}
          </div>
        ))}
        
        {/* Hover tooltip */}
        <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 text-white text-xs px-3 py-1 rounded-lg whitespace-nowrap z-10">
          Click to edit
        </div>
        
        {/* Edit icon on hover */}
        <div className="absolute -top-3 -right-3 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
          <Edit3 className="w-4 h-4 text-white" />
        </div>
      </div>
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

      {/* Demo Site Navigation - Single Line */}
      <div className="flex items-center justify-center space-x-4 mb-4">
        {/* Left Arrow */}
        <button
          onClick={prevSite}
          className="p-2 rounded-full border border-white/30 text-white/70 hover:text-white hover:border-white/50 transition-all duration-300"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        
        {/* Tab Buttons */}
        <div className="flex items-center space-x-3">
          {demoSites.map((site, index) => {
            const Icon = site.icon;
            return (
              <button
                key={site.id}
                onClick={() => {
                  setCurrentSite(index);
                  setEditableTexts(site.editableTexts);
                }}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-all duration-300 ${
                  currentSite === index 
                    ? `border-white text-white bg-white/10` 
                    : 'border-white/30 text-white/70 hover:text-white hover:border-white/50 hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{site.name}</span>
              </button>
            );
          })}
        </div>
        
        {/* Right Arrow */}
        <button
          onClick={nextSite}
          className="p-2 rounded-full border border-white/30 text-white/70 hover:text-white hover:border-white/50 transition-all duration-300"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ReCopy AI Widget */}
      <div className="mb-6 relative">
        {showDemoWidget && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-4 right-4 z-20 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-72"
          >
            {/* AI Prompt Input */}
            <div className="mb-4">
              <textarea
                placeholder="Describe how you want to improve the copy..."
                className="w-full p-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder-gray-500"
                rows={2}
                style={{ color: '#1f2937', backgroundColor: '#ffffff' }}
              />
              <button className="w-full mt-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white py-2 px-3 rounded-lg text-sm font-medium hover:from-blue-700 hover:to-purple-700 transition-all">
                ✨ Improve Copy
              </button>
            </div>
            
            {/* Quick Actions */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => {
                    const technicalTexts = {
                      headline: currentSiteData.theme === 'restaurant' ? 'Culinary Innovation Center' : 'Advanced Automotive Care',
                      subheading: currentSiteData.theme === 'restaurant'
                        ? 'State-of-the-art gastronomy utilizing molecular techniques and precision-sourced ingredients.'
                        : 'Professional-grade detailing services employing advanced ceramic coating technology.'
                    };
                    
                    setEditableTexts(prev => prev.map(item => 
                      technicalTexts[item.id as keyof typeof technicalTexts]
                        ? { ...item, text: technicalTexts[item.id as keyof typeof technicalTexts] }
                        : item
                    ));
                  }}
                  className="text-center p-2 rounded hover:bg-gray-50 border border-gray-200 transition-colors text-xs font-medium text-gray-800"
                >
                  🔬 Technical
                </button>
                
                <button 
                  onClick={() => {
                    const casualTexts = {
                      headline: currentSiteData.theme === 'restaurant' ? 'Amazing Food Spot' : 'Great Car Wash',
                      subheading: currentSiteData.theme === 'restaurant'
                        ? 'Come grab some seriously good Italian food made fresh daily!'
                        : 'We make your car look awesome with our friendly, professional service.'
                    };
                    
                    setEditableTexts(prev => prev.map(item => 
                      casualTexts[item.id as keyof typeof casualTexts]
                        ? { ...item, text: casualTexts[item.id as keyof typeof casualTexts] }
                        : item
                    ));
                  }}
                  className="text-center p-2 rounded hover:bg-gray-50 border border-gray-200 transition-colors text-xs font-medium text-gray-800"
                >
                  😊 Casual
                </button>
                
                <button 
                  onClick={() => {
                    const urgentTexts = {
                      headline: currentSiteData.theme === 'restaurant' ? 'Limited Seating Available' : 'Book Today - Spots Filling Fast',
                      subheading: currentSiteData.theme === 'restaurant'
                        ? 'Reserve your table now - only a few spots left for this weekend!'
                        : 'Don\'t wait! Schedule your premium car detail before we\'re fully booked.'
                    };
                    
                    setEditableTexts(prev => prev.map(item => 
                      urgentTexts[item.id as keyof typeof urgentTexts]
                        ? { ...item, text: urgentTexts[item.id as keyof typeof urgentTexts] }
                        : item
                    ));
                  }}
                  className="text-center p-2 rounded hover:bg-gray-50 border border-gray-200 transition-colors text-xs font-medium text-gray-800"
                >
                  ⚡ Urgent
                </button>
                
                <button 
                  onClick={() => {
                    setEditableTexts(demoSites[currentSite].editableTexts);
                  }}
                  className="text-center p-2 rounded hover:bg-gray-50 border border-gray-200 transition-colors text-xs font-medium text-gray-800"
                >
                  🔄 Reset
                </button>
              </div>
              
              {/* Language and Premium Row */}
              <div className="grid grid-cols-2 gap-2">
                <select 
                  onChange={(e) => {
                    if (e.target.value === 'es') {
                      const spanishTexts = {
                        headline: currentSiteData.theme === 'restaurant' ? 'Cocina Italiana Auténtica' : 'Detallado Premium de Autos',
                        subheading: currentSiteData.theme === 'restaurant' 
                          ? 'Experimenta los mejores platos italianos con ingredientes frescos y locales.'
                          : 'Servicios profesionales de lavado y detallado que hacen brillar tu vehículo.'
                      };
                      
                      setEditableTexts(prev => prev.map(item => 
                        spanishTexts[item.id as keyof typeof spanishTexts]
                          ? { ...item, text: spanishTexts[item.id as keyof typeof spanishTexts] }
                          : item
                      ));
                    } else if (e.target.value === 'fr') {
                      const frenchTexts = {
                        headline: currentSiteData.theme === 'restaurant' ? 'Cuisine Italienne Authentique' : 'Détail Auto Premium',
                        subheading: currentSiteData.theme === 'restaurant' 
                          ? 'Découvrez les meilleurs plats italiens avec des ingrédients frais et locaux.'
                          : 'Services professionnels de lavage et détail qui font briller votre véhicule.'
                      };
                      
                      setEditableTexts(prev => prev.map(item => 
                        frenchTexts[item.id as keyof typeof frenchTexts]
                          ? { ...item, text: frenchTexts[item.id as keyof typeof frenchTexts] }
                          : item
                      ));
                    }
                    e.target.value = '';
                  }}
                  className="p-2 border border-gray-200 rounded text-xs font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">🌍 Translate</option>
                  <option value="es">🇪🇸 Spanish</option>
                  <option value="fr">🇫🇷 French</option>
                  <option value="de">🇩🇪 German</option>
                  <option value="it">🇮🇹 Italian</option>
                </select>
                
                <button 
                  onClick={() => {
                    const premiumTexts = {
                      headline: currentSiteData.theme === 'restaurant' ? 'Exclusive Dining Experience' : 'Luxury Automotive Care',
                      subheading: currentSiteData.theme === 'restaurant'
                        ? 'Indulge in an extraordinary culinary journey crafted by world-renowned chefs.'
                        : 'Experience unparalleled automotive care with our premium detailing services.'
                    };
                    
                    setEditableTexts(prev => prev.map(item => 
                      premiumTexts[item.id as keyof typeof premiumTexts]
                        ? { ...item, text: premiumTexts[item.id as keyof typeof premiumTexts] }
                        : item
                    ));
                  }}
                  className="text-center p-2 rounded hover:bg-gray-50 border border-gray-200 transition-colors text-xs font-medium text-gray-800"
                >
                  ✨ Premium
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Demo Website Container */}
      <motion.div
        key={currentSite}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className={`bg-white rounded-2xl border border-gray-200 overflow-hidden relative`}
      >
        {/* Simplified Browser Chrome */}
        <div className="bg-gray-100 px-6 py-3 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <div className="flex space-x-2">
              <div className="w-3 h-3 bg-red-400 rounded-full"></div>
              <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
              <div className="w-3 h-3 bg-green-400 rounded-full"></div>
            </div>
            <div className="bg-white rounded-lg px-4 py-1 mx-4 border border-gray-200">
              <span className="text-gray-600 text-sm">https://{currentSiteData.name.toLowerCase().replace(/\s+/g, '')}.com</span>
            </div>
          </div>
          <div className="px-3 py-1 bg-green-500 text-white text-xs font-medium rounded-lg animate-pulse">
            ReCopyFast Active
          </div>
        </div>

        {/* Demo Website Content */}
        <div className="min-h-[700px] max-h-[700px] overflow-y-auto overflow-x-visible">
          {/* Restaurant Website Design */}
          {currentSiteData.theme === 'restaurant' && (
            <>
              {/* Hero Section with Background Image */}
              <div className="relative h-[400px] bg-gradient-to-br from-amber-900/90 to-orange-900/90">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200&h=400&fit=crop')] bg-cover bg-center mix-blend-overlay opacity-50"></div>
                <div className="relative z-10 h-full flex flex-col justify-center items-center text-white px-8">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-center"
                  >
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'headline')!} />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="mt-6 max-w-2xl text-center"
                  >
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'subheading')!} />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="mt-8"
                  >
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'cta')!} />
                  </motion.div>
                </div>
              </div>

              {/* About Section */}
              <div className="py-16 px-8">
                <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12 items-center">
                  <div>
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'about-title')!} />
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'about-text')!} />
                  </div>
                  <div className="relative group">
                    <EditableImageComponent 
                      src="https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&h=600" 
                      alt="Restaurant interior" 
                      className="w-full h-auto object-contain rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 group-hover:scale-105" 
                      imageType="restaurant"
                    />
                  </div>
                </div>
              </div>

              {/* Menu Section */}
              <div className="py-16 px-8">
                <div className="max-w-4xl mx-auto text-center">
                  <EditableTextComponent item={editableTexts.find(item => item.id === 'menu-title')!} />
                  <div className="grid md:grid-cols-2 gap-8 mt-12">
                    <div className="p-8 rounded-lg">
                      <EditableImageComponent 
                        src="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=600" 
                        alt="Special dish" 
                        className="w-full h-auto object-contain rounded-xl mb-4 shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-105" 
                        imageType="food"
                      />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'special-1')!} />
                    </div>
                    <div className="p-8 rounded-lg">
                      <EditableImageComponent 
                        src="https://images.unsplash.com/photo-1574484284002-952d92456975?w=800&h=600" 
                        alt="Special dish" 
                        className="w-full h-auto object-contain rounded-xl mb-4 shadow-lg hover:shadow-2xl transition-all duration-500 hover:scale-105" 
                        imageType="food"
                      />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'special-2')!} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Car Wash Website Design */}
          {currentSiteData.theme === 'carwash' && (
            <>
              {/* Modern Hero Section */}
              <div className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white">
                <div className="py-20 px-8">
                  <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
                    <div>
                      <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <EditableTextComponent item={editableTexts.find(item => item.id === 'headline')!} />
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4 }}
                        className="mt-6"
                      >
                        <EditableTextComponent item={editableTexts.find(item => item.id === 'subheading')!} />
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 }}
                        className="mt-8 flex gap-4"
                      >
                        <EditableTextComponent item={editableTexts.find(item => item.id === 'cta')!} />
                        <button className="px-6 py-3 border-2 border-white text-white rounded-lg hover:bg-white hover:text-blue-600 transition-all">
                          <EditableTextComponent item={editableTexts.find(item => item.id === 'view-pricing-btn')!} />
                        </button>
                      </motion.div>
                    </div>
                    <div className="relative group overflow-visible">
                      <EditableImageComponent 
                        src="https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=800&h=600" 
                        alt="Luxury car" 
                        className="w-full h-auto object-contain rounded-lg shadow-lg hover:shadow-2xl transition-all duration-500 group-hover:scale-105" 
                        imageType="car"
                      />
                      <div className="absolute -bottom-6 -left-6 bg-white p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                            <span className="text-white font-bold">✓</span>
                          </div>
                          <div>
                            <EditableTextComponent item={editableTexts.find(item => item.id === 'satisfaction-title')!} />
                            <EditableTextComponent item={editableTexts.find(item => item.id === 'satisfaction-subtitle')!} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Services Section */}
              <div className="py-16 px-8">
                <div className="max-w-4xl mx-auto">
                  <EditableTextComponent item={editableTexts.find(item => item.id === 'services-title')!} />
                  <EditableTextComponent item={editableTexts.find(item => item.id === 'service-desc')!} />
                  
                  {/* Service Cards */}
                  <div className="grid md:grid-cols-3 gap-6 mt-12">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                        <span className="text-2xl">🚿</span>
                      </div>
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'basic-wash-title')!} />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'basic-wash-desc')!} />
                    </div>
                    <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                        <span className="text-2xl">✨</span>
                      </div>
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'premium-detail-title')!} />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'premium-detail-desc')!} />
                    </div>
                    <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                        <span className="text-2xl">🛡️</span>
                      </div>
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'ceramic-coating-title')!} />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'ceramic-coating-desc')!} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Pricing Section */}
              <div className="py-16 px-8">
                <div className="max-w-4xl mx-auto text-center">
                  <EditableTextComponent item={editableTexts.find(item => item.id === 'pricing-title')!} />
                  <div className="grid md:grid-cols-2 gap-8 mt-12">
                    <div className="p-8 rounded-xl">
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'package-1')!} />
                    </div>
                    <div className="p-8 rounded-xl">
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'package-2')!} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Bakery Website Design */}
          {currentSiteData.theme === 'bakery' && (
            <>
              {/* Cozy Hero Section */}
              <div className="bg-gradient-to-br from-pink-100 to-rose-100">
                <div className="py-16 px-8">
                  <div className="max-w-6xl mx-auto text-center">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'headline')!} />
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.4 }}
                      className="mt-4 max-w-2xl mx-auto"
                    >
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'subheading')!} />
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6 }}
                      className="mt-8"
                    >
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'cta')!} />
                    </motion.div>

                    {/* Product Showcase */}
                    <div className="grid grid-cols-3 gap-6 mt-12 max-w-5xl mx-auto">
                      <div className="group overflow-visible">
                        <EditableImageComponent 
                          src="https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&h=600" 
                          alt="Fresh bread" 
                          className="w-full h-auto object-contain rounded-lg shadow-lg hover:shadow-2xl transition-all duration-500 group-hover:scale-105" 
                          imageType="bakery"
                        />
                      </div>
                      <div className="group overflow-visible">
                        <EditableImageComponent 
                          src="https://images.unsplash.com/photo-1486427944299-aa1a5e0def7d?w=600&h=600" 
                          alt="Cupcakes" 
                          className="w-full h-auto object-contain rounded-lg shadow-lg hover:shadow-2xl transition-all duration-500 group-hover:scale-105" 
                          imageType="bakery"
                        />
                      </div>
                      <div className="group overflow-visible">
                        <EditableImageComponent 
                          src="https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=600&h=600" 
                          alt="Croissants" 
                          className="w-full h-auto object-contain rounded-lg shadow-lg hover:shadow-2xl transition-all duration-500 group-hover:scale-105" 
                          imageType="bakery"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tradition Section */}
              <div className="py-16 px-8">
                <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12 items-center">
                  <div className="order-2 md:order-1 group overflow-visible">
                    <EditableImageComponent 
                      src="https://images.unsplash.com/photo-1556909212-d5b604d0c90d?w=800&h=600" 
                      alt="Baker at work" 
                      className="w-full h-auto object-contain rounded-lg shadow-lg hover:shadow-2xl transition-all duration-500 group-hover:scale-105" 
                      imageType="bakery"
                    />
                  </div>
                  <div className="order-1 md:order-2">
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'tradition-title')!} />
                    <EditableTextComponent item={editableTexts.find(item => item.id === 'tradition-text')!} />
                  </div>
                </div>
              </div>

              {/* Hours Section */}
              <div className="py-16 px-8">
                <div className="max-w-4xl mx-auto text-center">
                  <EditableTextComponent item={editableTexts.find(item => item.id === 'hours-title')!} />
                  <div className="p-8 rounded-xl max-w-md mx-auto mt-8">
                    <div className="space-y-4">
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'hours-1')!} />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'hours-2')!} />
                    </div>
                    <div className="mt-8 pt-8 border-t border-gray-200">
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'contact-address')!} />
                      <EditableTextComponent item={editableTexts.find(item => item.id === 'contact-phone')!} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        
        {/* ReCopy Button at Bottom */}
        <div className="absolute bottom-4 right-4">
          <button
            onClick={() => setShowDemoWidget(!showDemoWidget)}
            className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-2 shadow-lg"
          >
            <div className="relative">
              <Code className="h-4 w-4 text-blue-500" />
              <Zap className="h-2 w-2 text-purple-400 absolute -top-1 -right-1" />
            </div>
            ReCopy
          </button>
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
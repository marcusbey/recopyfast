'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, Sparkles, CheckCircle, ArrowRight } from 'lucide-react';

interface EditableText {
  id: string;
  text: string;
  isEditing: boolean;
  originalText: string;
}

export default function InteractiveHero() {
  const [editableTexts, setEditableTexts] = useState<EditableText[]>([
    {
      id: 'headline',
      text: 'Transform Your Website',
      isEditing: false,
      originalText: 'Transform Your Website'
    },
    {
      id: 'subheading',
      text: 'With just one script tag, edit your entire site in real-time.',
      isEditing: false,
      originalText: 'With just one script tag, edit your entire site in real-time.'
    },
    {
      id: 'cta',
      text: 'Start Free Trial',
      isEditing: false,
      originalText: 'Start Free Trial'
    }
  ]);

  const [isAutoDemo, setIsAutoDemo] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

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
          initial={{ scale: 1.02, boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.5)' }}
          animate={{ scale: 1.02, boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.5)' }}
          className="relative"
        >
          <input
            type="text"
            value={item.text}
            onChange={(e) => handleTextChange(item.id, e.target.value)}
            onBlur={() => handleTextSave(item.id)}
            onKeyDown={(e) => handleKeyPress(e, item.id)}
            className={`bg-transparent border-2 border-blue-500 rounded-lg px-3 py-2 outline-none ${
              item.id === 'headline' 
                ? 'text-4xl md:text-6xl lg:text-7xl font-bold'
                : item.id === 'subheading'
                ? 'text-xl md:text-2xl'
                : 'text-lg px-4 py-2'
            }`}
            autoFocus
          />
          <div className="absolute -top-8 left-0 bg-blue-600 text-white text-xs px-2 py-1 rounded-md">
            Press Enter to save, Esc to cancel
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        onClick={() => handleTextClick(item.id)}
        className={`cursor-pointer hover:bg-blue-50 hover:bg-opacity-30 rounded-lg transition-all duration-200 relative group ${
          item.id === 'headline' 
            ? 'text-4xl md:text-6xl lg:text-7xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent'
            : item.id === 'subheading'
            ? 'text-xl md:text-2xl text-gray-600'
            : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-3 text-lg rounded-xl font-semibold shadow-lg'
        }`}
      >
        {item.text}
        <div className="absolute -top-6 left-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 text-white text-xs px-2 py-1 rounded-md whitespace-nowrap">
          Click to edit
        </div>
        {item.id !== 'cta' && (
          <Wand2 className="absolute -right-6 top-1/2 transform -translate-y-1/2 w-4 h-4 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
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

      {/* Interactive Demo Banner */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-center py-4 mb-12 rounded-xl relative overflow-hidden shadow-lg"
      >
        <Sparkles className="absolute left-6 top-1/2 transform -translate-y-1/2 w-5 h-5 animate-pulse" />
        <p className="text-sm font-medium">
          ✨ <strong>Interactive Demo:</strong> Click any text below to edit it in real-time
        </p>
        <button
          onClick={runAutoDemo}
          disabled={isAutoDemo}
          className="absolute right-6 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-20 hover:bg-opacity-30 px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
        >
          {isAutoDemo ? 'Running Demo...' : 'Auto Demo'}
        </button>
      </motion.div>

      {/* Hero Content */}
      <div className="text-center space-y-8">
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
          className="max-w-3xl mx-auto"
        >
          <EditableTextComponent item={editableTexts.find(item => item.id === 'subheading')!} />
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <EditableTextComponent item={editableTexts.find(item => item.id === 'cta')!} />
          
          <button className="border border-gray-300 px-8 py-3 rounded-xl hover:bg-gray-50 transition flex items-center gap-2 text-lg font-semibold text-gray-700 hover:text-gray-900">
            View Live Demo
            <ArrowRight className="w-5 h-5" />
          </button>
        </motion.div>

        {/* Code Preview */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="max-w-2xl mx-auto mt-12"
        >
          <div className="bg-gray-900 rounded-xl p-6 text-left shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <span className="text-green-400 text-sm font-medium">Ready to integrate?</span>
              <div className="flex space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              </div>
            </div>
            <motion.code 
              className="text-green-400 font-mono text-sm block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.0 }}
            >
              {'<script src="https://cdn.recopyfast.com/embed/recopyfast.js"'}
              <br />
              {'        data-site-id="your-site-id"></script>'}
            </motion.code>
            <motion.p 
              className="text-gray-400 text-xs mt-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
            >
              That&apos;s it! Your website becomes instantly editable.
            </motion.p>
          </div>
        </motion.div>

        {/* Live Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="flex justify-center items-center space-x-8 mt-12 text-sm text-gray-600"
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>Live on 10,000+ websites</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span>99.9% uptime</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
            <span>&lt;100ms response time</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
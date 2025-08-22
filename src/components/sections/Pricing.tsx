'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Zap, Crown, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';

const pricingPlans = [
  {
    name: 'Starter',
    price: 0,
    period: 'month',
    description: 'Perfect for personal projects and small websites',
    icon: Zap,
    popular: false,
    features: [
      '1 website',
      '10,000 page views/month',
      'Basic content editing',
      'Community support',
      'Basic analytics',
      'Standard security'
    ],
    limitations: [
      'Limited to 1 website',
      'Basic features only'
    ],
    cta: 'Get Started Free',
    gradient: 'from-gray-500 to-gray-600'
  },
  {
    name: 'Professional',
    price: 29,
    period: 'month',
    description: 'Ideal for growing businesses and agencies',
    icon: Crown,
    popular: true,
    features: [
      '5 websites',
      '100,000 page views/month',
      'Advanced content editing',
      'AI-powered suggestions',
      'Priority support',
      'Advanced analytics',
      'Team collaboration',
      'Custom domains',
      'Version history',
      'Enhanced security'
    ],
    cta: 'Start Free Trial',
    gradient: 'from-blue-500 to-purple-600'
  },
  {
    name: 'Enterprise',
    price: 99,
    period: 'month',
    description: 'For large organizations with advanced needs',
    icon: Rocket,
    popular: false,
    features: [
      'Unlimited websites',
      'Unlimited page views',
      'All Professional features',
      'White-label solution',
      'Dedicated account manager',
      'SLA guarantee',
      'Advanced integrations',
      'Custom workflows',
      'Audit logs',
      'SSO authentication',
      'Advanced security'
    ],
    cta: 'Contact Sales',
    gradient: 'from-purple-500 to-pink-600'
  }
];

const backgroundElements = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: 20 + Math.random() * 40,
  duration: 10 + Math.random() * 20
}));

export default function Pricing() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.5
      }
    }
  };

  const getDisplayPrice = (price: number) => {
    if (price === 0) return 0;
    return billingPeriod === 'yearly' ? Math.floor(price * 0.8) : price;
  };

  return (
    <section className="py-24 px-6 bg-gradient-to-br from-gray-50 via-blue-50/20 to-purple-50/30 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0">
        {backgroundElements.map((element) => (
          <motion.div
            key={element.id}
            className="absolute rounded-full bg-gradient-to-r from-blue-400/10 to-purple-400/10 blur-xl"
            style={{
              left: `${element.x}%`,
              top: `${element.y}%`,
              width: element.size,
              height: element.size,
            }}
            animate={{
              x: [0, 30, 0],
              y: [0, -30, 0],
              scale: [1, 1.1, 1],
            }}
            transition={{
              duration: element.duration,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Floating Geometric Shapes */}
      <motion.div 
        className="absolute top-20 left-10 w-16 h-16 border border-blue-200 rounded-lg opacity-20"
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      />
      <motion.div 
        className="absolute top-40 right-20 w-12 h-12 bg-purple-200 rounded-full opacity-20"
        animate={{ y: [-10, 10, -10] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div 
        className="absolute bottom-40 left-20 w-8 h-8 bg-gradient-to-r from-blue-300 to-purple-300 rounded-full opacity-30"
        animate={{ x: [-5, 5, -5], y: [0, -8, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="container mx-auto max-w-7xl relative z-10">
        <motion.div 
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={itemVariants}
        >
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Choose the perfect plan for your needs. All plans include our core features 
            with no hidden fees.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center mb-8">
            <div className="bg-white rounded-full p-1 border border-gray-200">
              <div className="flex">
                <button
                  onClick={() => setBillingPeriod('monthly')}
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    billingPeriod === 'monthly'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-blue-600'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingPeriod('yearly')}
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    billingPeriod === 'yearly'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-blue-600'
                  }`}
                >
                  Yearly
                  <span className="ml-2 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                    Save 20%
                  </span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div 
          className="grid md:grid-cols-3 gap-8"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={containerVariants}
        >
          {pricingPlans.map((plan, index) => {
            const Icon = plan.icon;
            const displayPrice = getDisplayPrice(plan.price);
            
            return (
              <motion.div
                key={plan.name}
                variants={itemVariants}
                className={`relative bg-white rounded-2xl border-2 p-8 ${
                  plan.popular 
                    ? 'border-blue-500 ring-4 ring-blue-100' 
                    : 'border-gray-100 hover:border-gray-200'
                } transition-all duration-300`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-full text-sm font-medium">
                      Most Popular
                    </div>
                  </div>
                )}

                <div className="text-center mb-8">
                  <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-r ${plan.gradient} mb-4`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                  <p className="text-gray-600 text-sm mb-6">{plan.description}</p>
                  
                  <div className="flex items-baseline justify-center mb-2">
                    <span className="text-5xl font-bold text-gray-900">
                      ${displayPrice}
                    </span>
                    <span className="text-gray-500 ml-2">/{plan.period}</span>
                  </div>
                  
                  {billingPeriod === 'yearly' && plan.price > 0 && (
                    <p className="text-sm text-green-600 font-medium">
                      ${plan.price * 12 - displayPrice * 12} saved annually
                    </p>
                  )}
                </div>

                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start">
                      <Check className="w-5 h-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
                      <span className="text-gray-700 text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button 
                  className={`w-full py-3 font-medium rounded-xl transition-all duration-200 ${
                    plan.popular
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-900 border-0'
                  }`}
                >
                  {plan.cta}
                </Button>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div 
          className="text-center mt-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={itemVariants}
        >
          <p className="text-gray-600 mb-6">
            All plans include a 14-day free trial. No credit card required.
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 text-sm text-gray-500">
            <div className="flex items-center">
              <Check className="w-4 h-4 text-green-500 mr-2" />
              30-day money-back guarantee
            </div>
            <div className="flex items-center">
              <Check className="w-4 h-4 text-green-500 mr-2" />
              Cancel anytime
            </div>
            <div className="flex items-center">
              <Check className="w-4 h-4 text-green-500 mr-2" />
              24/7 support
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
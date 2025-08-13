'use client';

import { useState, useEffect } from 'react';
import { Star, TrendingUp, Users, Clock, ChevronLeft, ChevronRight } from "lucide-react";

const featuredTestimonial = {
  name: "Sarah Chen",
  role: "Marketing Director",
  company: "TechFlow Inc",
  content: "ReCopyFast revolutionized our content workflow. What used to take our team days now happens in minutes. We've deployed it across 50+ client websites with incredible results - 500% faster updates, 95% client satisfaction, and our team finally has the independence they needed.",
  rating: 5,
  avatar: "https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop",
  metrics: [
    { value: "500%", label: "Faster Updates" },
    { value: "50+", label: "Websites" },
    { value: "95%", label: "Client Satisfaction" }
  ]
};

const testimonials = [
  {
    name: "Marcus Rodriguez",
    role: "CTO",
    company: "BuildFast Solutions", 
    content: "Finally, a CMS that doesn't require rebuilding everything. We integrated ReCopyFast in 10 minutes and our clients love the real-time editing capabilities.",
    rating: 5,
    avatar: "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop"
  },
  {
    name: "Emily Watson",
    role: "Agency Owner",
    company: "Creative Collective",
    content: "Our clients love being able to edit their sites directly. It's become our biggest differentiator when pitching new projects. The AI suggestions are a game-changer.",
    rating: 5,
    avatar: "https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop"
  },
  {
    name: "David Park",
    role: "Product Manager",
    company: "StartupXYZ",
    content: "We launched 3 A/B tests in one afternoon using ReCopyFast. The speed and ease of content iteration has transformed how we approach product messaging.",
    rating: 5,
    avatar: "https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop"
  },
  {
    name: "Lisa Thompson",
    role: "Content Strategist",
    company: "GrowthLab",
    content: "The multi-language support saved us weeks of development time. Now our international content goes live instantly across all markets.",
    rating: 5,
    avatar: "https://images.pexels.com/photos/1065084/pexels-photo-1065084.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop"
  },
  {
    name: "James Wilson",
    role: "Technical Director",
    company: "WebCraft Studios",
    content: "Integration was seamless and the performance impact is negligible. Our developers love that they can focus on features instead of content updates.",
    rating: 5,
    avatar: "https://images.pexels.com/photos/1300402/pexels-photo-1300402.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop"
  },
  {
    name: "Anna Martinez",
    role: "UX Designer",
    company: "DesignForward",
    content: "The real-time collaboration features let our entire team contribute to copy decisions. Version control gives us confidence to iterate quickly.",
    rating: 5,
    avatar: "https://images.pexels.com/photos/1036623/pexels-photo-1036623.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop"
  }
];

const metrics = [
  {
    icon: Users,
    value: "15,000+",
    label: "Websites Transformed",
    description: "Growing daily"
  },
  {
    icon: TrendingUp,
    value: "99.9%",
    label: "Uptime",
    description: "Reliable performance"
  },
  {
    icon: Clock,
    value: "<100ms",
    label: "Average Response",
    description: "Lightning fast"
  }
];

const companies = [
  { name: "TechFlow", logo: "TF" },
  { name: "BuildFast", logo: "BF" },
  { name: "Creative Co", logo: "CC" },
  { name: "StartupXYZ", logo: "SX" },
  { name: "GrowthLab", logo: "GL" },
  { name: "WebCraft", logo: "WC" },
  { name: "DesignForward", logo: "DF" },
  { name: "InnovateNow", logo: "IN" }
];

export default function EnhancedSocialProof() {
  const [currentTestimonial, setCurrentTestimonial] = useState(0);

  const nextTestimonial = () => {
    setCurrentTestimonial((prev) => (prev + 1) % testimonials.length);
  };

  const prevTestimonial = () => {
    setCurrentTestimonial((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  // Auto-advance carousel
  useEffect(() => {
    const timer = setInterval(nextTestimonial, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="py-20 bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Company Logos */}
        <div className="text-center mb-16">
          <p className="text-lg font-medium text-gray-500 mb-8">
            Trusted by innovative companies worldwide
          </p>
          
          <div className="flex flex-wrap justify-center items-center gap-6">
            {companies.map((company, index) => (
              <div
                key={index}
                className="w-16 h-16 bg-white rounded-xl shadow-lg flex items-center justify-center border border-gray-200 hover:shadow-xl transition-all duration-300 hover:scale-105"
              >
                <span className="text-lg font-bold text-gray-700">{company.logo}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className="grid md:grid-cols-3 gap-8 mb-20">
          {metrics.map((metric, index) => (
            <div
              key={index}
              className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200 text-center hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                <metric.icon className="h-8 w-8 text-white" />
              </div>
              <div className="text-4xl font-bold text-gray-900 mb-2">{metric.value}</div>
              <div className="text-lg font-semibold text-gray-700 mb-1">{metric.label}</div>
              <p className="text-gray-500 text-sm">{metric.description}</p>
            </div>
          ))}
        </div>

        {/* Featured Testimonial */}
        <div className="mb-20">
          <h3 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-16">
            Success Stories from Our Customers
          </h3>
          
          <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-3xl p-1">
            <div className="bg-white rounded-3xl p-12">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-center mb-8">
                  {[...Array(featuredTestimonial.rating)].map((_, i) => (
                    <Star key={i} className="h-6 w-6 text-yellow-400 fill-current mx-1" />
                  ))}
                </div>
                
                <blockquote className="text-xl md:text-2xl text-gray-800 text-center mb-8 leading-relaxed">
                  "{featuredTestimonial.content}"
                </blockquote>
                
                <div className="flex flex-col md:flex-row items-center justify-center mb-8">
                  <img
                    src={featuredTestimonial.avatar}
                    alt={featuredTestimonial.name}
                    className="w-20 h-20 rounded-full mr-0 md:mr-6 mb-4 md:mb-0 object-cover shadow-lg"
                  />
                  <div className="text-center md:text-left">
                    <div className="font-bold text-xl text-gray-900">{featuredTestimonial.name}</div>
                    <div className="text-gray-600 text-lg">
                      {featuredTestimonial.role} at {featuredTestimonial.company}
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-8 pt-8 border-t border-gray-200">
                  {featuredTestimonial.metrics.map((metric, index) => (
                    <div key={index} className="text-center">
                      <div className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                        {metric.value}
                      </div>
                      <p className="text-gray-600 font-medium">{metric.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Testimonial Carousel */}
        <div className="mb-16">
          <h4 className="text-2xl font-bold text-center text-gray-900 mb-12">
            More Customer Stories
          </h4>
          
          <div className="relative">
            {/* Carousel Container */}
            <div className="overflow-hidden">
              <div 
                className="flex transition-transform duration-500 ease-in-out"
                style={{ transform: `translateX(-${currentTestimonial * (100 / 3)}%)` }}
              >
                {testimonials.map((testimonial, index) => (
                  <div
                    key={index}
                    className="w-full md:w-1/3 flex-shrink-0 px-4"
                  >
                    <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 h-full">
                      <div className="flex items-center mb-4">
                        {[...Array(testimonial.rating)].map((_, i) => (
                          <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                        ))}
                      </div>
                      
                      <blockquote className="text-gray-700 mb-6 italic text-sm leading-relaxed">
                        "{testimonial.content}"
                      </blockquote>
                      
                      <div className="flex items-center mt-auto">
                        <img
                          src={testimonial.avatar}
                          alt={testimonial.name}
                          className="w-12 h-12 rounded-full mr-4 object-cover"
                        />
                        <div>
                          <div className="font-semibold text-gray-900">{testimonial.name}</div>
                          <div className="text-gray-600 text-sm">
                            {testimonial.role} at {testimonial.company}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation Buttons */}
            <button
              onClick={prevTestimonial}
              className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-6 bg-white rounded-full p-3 shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              <ChevronLeft className="h-6 w-6 text-gray-600" />
            </button>
            
            <button
              onClick={nextTestimonial}
              className="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-6 bg-white rounded-full p-3 shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              <ChevronRight className="h-6 w-6 text-gray-600" />
            </button>

            {/* Dots Indicator */}
            <div className="flex justify-center mt-8 space-x-2">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentTestimonial(index)}
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    currentTestimonial === index 
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 scale-125' 
                      : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
/**
 * ReCopyFast Editing Rules
 * 
 * This file defines the core rules and behaviors for content editing
 * to ensure consistent user experience across all demo websites.
 */

export interface EditingRules {
  text: TextEditingRules;
  image: ImageEditingRules;
  container: ContainerRules;
}

export interface TextEditingRules {
  // Preserve original formatting
  preserveOriginalFormat: boolean;
  preserveBackgroundColor: boolean;
  preserveFontFamily: boolean;
  preserveFontSize: boolean;
  preserveTextAlign: boolean;
  preservePadding: boolean;
  preserveMargin: boolean;
  
  // Container behavior
  maintainContainerDimensions: boolean;
  allowTextOverflow: boolean;
  scrollBehavior: 'hidden' | 'auto' | 'visible';
  
  // Editing states
  editingBackgroundColor: string;
  editingBorderStyle: string;
  focusRingColor: string;
}

export interface ImageEditingRules {
  // Preserve container
  preserveContainerSize: boolean;
  preserveAspectRatio: boolean;
  preserveBorderRadius: boolean;
  
  // Editing options
  allowRandomGeneration: boolean;
  allowPromptGeneration: boolean;
  allowUnsplashSearch: boolean;
  
  // Modal behavior
  showEditingModal: boolean;
  modalPosition: 'center' | 'overlay' | 'sidebar';
}

export interface ContainerRules {
  // Dimension preservation
  lockWidth: boolean;
  lockHeight: boolean;
  lockPosition: boolean;
  
  // Overflow handling
  textOverflow: 'ellipsis' | 'clip' | 'visible';
  overflowWrap: 'normal' | 'break-word' | 'anywhere';
}

/**
 * Default editing rules applied to all editable content
 */
export const DEFAULT_EDITING_RULES: EditingRules = {
  text: {
    // Preserve all original formatting
    preserveOriginalFormat: true,
    preserveBackgroundColor: true,
    preserveFontFamily: true,
    preserveFontSize: true,
    preserveTextAlign: true,
    preservePadding: true,
    preserveMargin: true,
    
    // Container behavior - maintain original dimensions
    maintainContainerDimensions: true,
    allowTextOverflow: true,
    scrollBehavior: 'visible',
    
    // Subtle editing indicators
    editingBackgroundColor: 'transparent', // No background change
    editingBorderStyle: '2px solid #3b82f6',
    focusRingColor: '#3b82f6'
  },
  
  image: {
    // Preserve container properties
    preserveContainerSize: true,
    preserveAspectRatio: true,
    preserveBorderRadius: true,
    
    // Enable all editing options
    allowRandomGeneration: true,
    allowPromptGeneration: true,
    allowUnsplashSearch: true,
    
    // Show overlay modal for image editing
    showEditingModal: true,
    modalPosition: 'overlay'
  },
  
  container: {
    // Lock all dimensions during editing
    lockWidth: true,
    lockHeight: false, // Allow height to grow for longer text
    lockPosition: true,
    
    // Handle text overflow gracefully
    textOverflow: 'visible',
    overflowWrap: 'break-word'
  }
};

/**
 * Generate CSS styles for text editing that preserve original formatting
 */
export function getTextEditingStyles(originalElement: HTMLElement): React.CSSProperties {
  const computedStyle = window.getComputedStyle(originalElement);
  
  return {
    // Preserve all visual properties EXACTLY
    fontFamily: computedStyle.fontFamily,
    fontSize: computedStyle.fontSize,
    fontWeight: computedStyle.fontWeight,
    fontStyle: computedStyle.fontStyle,
    lineHeight: computedStyle.lineHeight,
    letterSpacing: computedStyle.letterSpacing,
    color: computedStyle.color,
    textAlign: computedStyle.textAlign as any,
    textDecoration: computedStyle.textDecoration,
    textTransform: computedStyle.textTransform,
    
    // Preserve spacing EXACTLY
    padding: computedStyle.padding,
    paddingTop: computedStyle.paddingTop,
    paddingRight: computedStyle.paddingRight,
    paddingBottom: computedStyle.paddingBottom,
    paddingLeft: computedStyle.paddingLeft,
    margin: computedStyle.margin,
    marginTop: computedStyle.marginTop,
    marginRight: computedStyle.marginRight,
    marginBottom: computedStyle.marginBottom,
    marginLeft: computedStyle.marginLeft,
    
    // Maintain dimensions EXACTLY
    width: computedStyle.width,
    minWidth: computedStyle.minWidth,
    maxWidth: computedStyle.maxWidth,
    minHeight: computedStyle.height,
    boxSizing: computedStyle.boxSizing,
    
    // Preserve background (no change during editing)
    backgroundColor: computedStyle.backgroundColor,
    backgroundImage: computedStyle.backgroundImage,
    backgroundSize: computedStyle.backgroundSize,
    backgroundPosition: computedStyle.backgroundPosition,
    backgroundRepeat: computedStyle.backgroundRepeat,
    
    // Preserve border radius and other visual elements
    borderRadius: computedStyle.borderRadius,
    borderTopLeftRadius: computedStyle.borderTopLeftRadius,
    borderTopRightRadius: computedStyle.borderTopRightRadius,
    borderBottomLeftRadius: computedStyle.borderBottomLeftRadius,
    borderBottomRightRadius: computedStyle.borderBottomRightRadius,
    
    // Preserve shadows and effects
    boxShadow: computedStyle.boxShadow,
    textShadow: computedStyle.textShadow,
    
    // Editing-specific styles (minimal override)
    border: '2px solid #3b82f6', // Blue editing indicator
    outline: 'none',
    resize: 'none',
    
    // Text overflow handling - preserve original or allow natural growth
    overflow: 'visible',
    overflowWrap: 'break-word',
    wordWrap: 'break-word',
    whiteSpace: computedStyle.whiteSpace === 'nowrap' ? 'normal' : computedStyle.whiteSpace,
  };
}

/**
 * Enhanced rules for maintaining text consistency during editing
 */
export const TEXT_EDITING_CONSISTENCY_RULES = {
  // Always preserve these properties exactly
  preserveExactly: [
    'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
    'lineHeight', 'letterSpacing', 'textAlign', 'color',
    'padding', 'margin', 'backgroundColor', 'borderRadius',
    'boxShadow', 'textShadow', 'textDecoration', 'textTransform'
  ],
  
  // Handle these properties with special logic
  handleSpecially: {
    width: 'maintain', // Keep original width
    height: 'auto-expand', // Allow height to grow naturally
    whiteSpace: 'normalize-if-nowrap', // Allow text wrapping if originally nowrap
    overflow: 'make-visible' // Ensure text is always visible
  },
  
  // Minimal editing indicators
  editingIndicators: {
    border: '2px solid #3b82f6',
    outline: 'none',
    cursor: 'text'
  }
};

/**
 * Generate CSS styles for image containers during editing
 */
export function getImageEditingStyles(originalElement: HTMLElement): React.CSSProperties {
  const computedStyle = window.getComputedStyle(originalElement);
  
  return {
    width: computedStyle.width,
    height: computedStyle.height,
    borderRadius: computedStyle.borderRadius,
    objectFit: computedStyle.objectFit as any,
    objectPosition: computedStyle.objectPosition,
    transition: 'all 0.2s ease',
  };
}

/**
 * Unsplash categories for different image types
 */
export const UNSPLASH_CATEGORIES = {
  restaurant: ['food', 'restaurant', 'cuisine', 'dining', 'chef', 'kitchen'],
  car: ['car', 'automobile', 'vehicle', 'luxury-car', 'sports-car', 'automotive'],
  bakery: ['bakery', 'bread', 'pastry', 'cake', 'baking', 'dessert'],
  general: ['business', 'office', 'modern', 'professional', 'abstract'],
} as const;

/**
 * Generate random Unsplash image URL based on category
 */
export function generateUnsplashUrl(
  category: keyof typeof UNSPLASH_CATEGORIES, 
  width: number = 400, 
  height: number = 300
): string {
  const keywords = UNSPLASH_CATEGORIES[category];
  const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];
  return `https://source.unsplash.com/${width}x${height}/?${randomKeyword}&${Date.now()}`;
}

/**
 * Validation rules for editing content
 */
export const VALIDATION_RULES = {
  text: {
    maxLength: 500,
    minLength: 1,
    allowedCharacters: /^[\w\s\-.,!?()'"\/&@#$%:;+=]*$/,
  },
  image: {
    allowedDomains: ['unsplash.com', 'source.unsplash.com', 'images.unsplash.com'],
    maxPromptLength: 100,
    minPromptLength: 3,
  }
};
# ReCopyFast Editing System

## Overview

The ReCopyFast editing system provides a comprehensive set of rules and behaviors for content editing that ensures a consistent user experience across all demo websites while preserving the original design and formatting.

## Core Editing Rules

### 🎯 Text Editing Principles

1. **Format Preservation**: All original formatting (font, size, color, alignment, etc.) is preserved during editing
2. **Container Stability**: The container dimensions remain stable during editing - width is locked, height can grow naturally
3. **Background Integrity**: No background changes occur during editing - maintains original colors and styles
4. **Overflow Handling**: Text can overflow the original container height naturally, with proper word wrapping
5. **Visual Consistency**: Only a subtle blue border indicates editing mode

### 🖼️ Image Editing Principles  

1. **Container Preservation**: Image container size and aspect ratio are maintained
2. **Modal Interface**: Clean, centered modal for image editing options
3. **Multiple Options**: Users can generate from description, get random images, or cancel
4. **Prompt-Based Generation**: Smart keyword detection for theme-appropriate image generation
5. **Instant Feedback**: Loading states and success animations provide clear user feedback

## Implementation Details

### Text Editing Features

- **Automatic Input Type**: Short text uses `<input>`, longer content uses `<textarea>`
- **Keyboard Shortcuts**: 
  - `Enter` or `Ctrl+Enter` to save
  - `Escape` to cancel and restore original text
- **Inline Editing**: Edit text directly in place with preserved styling
- **Word Wrapping**: Proper handling of text overflow with `break-word` and `overflow-wrap`

### Image Editing Features

- **Hover Activation**: Image editing is triggered by hovering over images
- **Smart Prompting**: AI-powered image generation based on text descriptions
- **Category Detection**: Automatic theme detection based on prompt keywords
- **Random Generation**: One-click random image generation using Unsplash
- **Theme Integration**: Generated images match the current demo site theme

### Technical Architecture

#### Files Structure

```
src/
├── lib/
│   └── editingRules.ts        # Core editing rules and utilities
└── components/
    └── landing/
        └── InteractiveHero.tsx # Main implementation
```

#### Key Components

1. **DEFAULT_EDITING_RULES**: Configuration object defining all editing behaviors
2. **getTextEditingStyles()**: Generates CSS styles that preserve original formatting  
3. **generateUnsplashUrl()**: Creates theme-appropriate Unsplash URLs
4. **EditableTextComponent**: React component for text editing with rules enforcement
5. **EditableImageComponent**: React component for image editing with modal interface

#### Styling Rules

```typescript
// Text editing preserves all original styles
{
  fontFamily: 'inherit',
  fontSize: 'inherit', 
  backgroundColor: 'transparent', // No background change
  border: '2px solid #3b82f6',   // Blue editing indicator
  overflow: 'visible',           // Allow natural text overflow
  wordWrap: 'break-word'         // Handle long text gracefully
}
```

## User Experience Flow

### Text Editing Flow

1. **Hover**: User hovers over editable text → Shows "Click to edit" tooltip with edit icon
2. **Click**: User clicks text → Enters editing mode with blue border, no background change
3. **Edit**: User types → Text expands naturally, container width stays same  
4. **Save**: User presses Enter → Saves changes, shows success animation
5. **Cancel**: User presses Escape → Reverts to original text

### Image Editing Flow

1. **Hover**: User hovers over image → Shows semi-transparent overlay with "Edit Image" button
2. **Click**: User clicks overlay → Opens image editing modal with current image preview
3. **Describe**: User types description → "Generate from Description" button becomes active
4. **Generate**: User clicks generate → Shows loading spinner, generates new image
5. **Apply**: New image loads → Modal closes, success animation shows, image updates

## Validation & Error Handling

### Text Validation
- **Length Limits**: 1-500 characters
- **Character Restrictions**: Alphanumeric, punctuation, common symbols
- **Line Breaks**: Properly handled in textarea mode

### Image Validation  
- **Prompt Length**: 3-100 characters
- **Domain Restrictions**: Only Unsplash domains allowed for demo
- **Error Fallback**: Falls back to random image if generation fails
- **Loading States**: Clear feedback during generation

## Demo Integration

### Multi-Site Support

The editing system works across all demo site themes:

- **Restaurant**: Food, dining, cuisine-focused images and copy
- **Car Wash**: Automotive, detailing, service-focused content  
- **Bakery**: Bread, pastries, artisan-focused imagery and text

### Theme-Aware Generation

```typescript
// Automatic category detection for images
if (prompt.includes('food')) category = 'food';
if (prompt.includes('car')) category = 'car';  
if (prompt.includes('bakery')) category = 'bakery';
```

## Performance Considerations

- **Lazy Loading**: Image modal only renders when needed
- **Debounced Updates**: Text changes are batched to prevent excessive re-renders
- **Lightweight Modals**: Modals use AnimatePresence for smooth transitions
- **Memory Management**: Event listeners are properly cleaned up

## Future Enhancements

### Planned Features
- **Real AI Integration**: Replace demo Unsplash generation with actual AI image generation (DALL-E, Midjourney)
- **Advanced Prompting**: More sophisticated prompt engineering for better image results
- **Bulk Editing**: Multi-select editing for batch operations
- **Version History**: Track and revert editing changes
- **Collaborative Editing**: Real-time collaborative editing features

### API Integration Points
```typescript
// Future AI service integration
interface AIImageService {
  generateImage(prompt: string, style?: string): Promise<string>;
  enhancePrompt(prompt: string): string;
  suggestVariations(prompt: string): string[];
}
```

## Testing Recommendations

### Manual Testing Checklist

**Text Editing:**
- [ ] Click any text element to enter edit mode
- [ ] Verify background doesn't change during editing
- [ ] Test long text overflow behavior
- [ ] Verify formatting preservation
- [ ] Test keyboard shortcuts (Enter, Escape)

**Image Editing:**  
- [ ] Hover over images to see edit overlay
- [ ] Open image modal and test prompt input
- [ ] Generate images from descriptions
- [ ] Test random image generation
- [ ] Verify error handling for failed generations

**Cross-Browser:**
- [ ] Test in Chrome, Firefox, Safari
- [ ] Verify mobile responsiveness
- [ ] Test keyboard navigation
- [ ] Verify accessibility features

## Conclusion

The ReCopyFast editing system provides a robust, user-friendly approach to content editing that maintains design integrity while offering powerful customization options. The system is built with extensibility in mind, making it easy to add new features and integrate with external AI services as needed.
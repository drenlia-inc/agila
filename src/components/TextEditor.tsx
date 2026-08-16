import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';
import { useSettings } from '../contexts/SettingsContext';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Image from '@tiptap/extension-image';
import Heading from '@tiptap/extension-heading';
import Strike from '@tiptap/extension-strike';
import { ModernCheckbox } from './ModernCheckbox';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { getAuthenticatedAttachmentUrl } from '../utils/authImageUrl';
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  Link2, 
  Paperclip,
  List,
  ListOrdered,
  Check,
  X,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Strikethrough,
  Table as TableIcon,
  ChevronDown
} from 'lucide-react';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';

interface ToolbarOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  heading?: boolean;
  code?: boolean;
  codeBlock?: boolean;
  table?: boolean;
  link?: boolean;
  lists?: boolean;
  alignment?: boolean;
  attachments?: boolean;
}

interface TextEditorProps {
  onSubmit: (content: string, attachments?: File[]) => Promise<void>;
  onCancel?: () => void;
  onChange?: (content: string) => void;
  onAttachmentsChange?: (attachments: File[]) => void;
  onAttachmentDelete?: (attachmentId: string) => Promise<void>;
  onImageRemovalNeeded?: (attachmentName: string) => void; // Called when image is removed to sync attachments
  initialContent?: string;
  isEditing?: boolean;
  showAttachments?: boolean;
  placeholder?: string;
  minHeight?: string;
  showToolbar?: boolean;
  showSubmitButtons?: boolean;
  submitButtonText?: string;
  cancelButtonText?: string;
  toolbarOptions?: ToolbarOptions;
  variant?: 'full' | 'inline'; // 'full' = TaskDetails/TaskPage, 'inline' = TaskCard/ListView
  className?: string;
  editorClassName?: string;
  resizable?: boolean;
  compact?: boolean;
  // New props for attachment context
  attachmentContext?: 'task' | 'comment';
  attachmentParentId?: string;
  existingAttachments?: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }>;
  // Image behavior control props
  allowImagePaste?: boolean;   // Allow pasting new images (default: true)
  allowImageDelete?: boolean;  // Show delete button on images (default: true)
  allowImageResize?: boolean;  // Allow resizing images (default: true)
  imageDisplayMode?: 'full' | 'compact'; // Image display size (default: 'full')
  /** When false, TipTap content is not editable (e.g. soft-deleted task details). Default true. */
  editable?: boolean;
  /** When set, extra typing/paste that would exceed this HTML length is undone. */
  maxLength?: number;
}

const defaultToolbarOptions: ToolbarOptions = {
  bold: true,
  italic: true,
  underline: true,
  strikethrough: false,
  heading: false,
  code: false,
  codeBlock: false,
  table: false,
  link: true,
  lists: true,
  alignment: false,
  attachments: false,
};

// Full variant toolbar (TaskDetails/TaskPage)
const fullToolbarOptions: ToolbarOptions = {
  bold: true,
  italic: true,
  underline: true,
  strikethrough: true,
  heading: true,
  code: true,
  codeBlock: true,
  table: true,
  link: true,
  lists: true,
  alignment: false,
  attachments: false,
};

// Inline variant toolbar (TaskCard/ListView)
const inlineToolbarOptions: ToolbarOptions = {
  bold: true,
  italic: true,
  underline: false,
  strikethrough: true,
  heading: true,
  code: false,
  codeBlock: false,
  table: false,
  link: true,
  lists: true,
  alignment: false,
  attachments: false,
};

export default function TextEditor({
  onSubmit,
  onCancel,
  onChange,
  onAttachmentsChange,
  onAttachmentDelete,
  onImageRemovalNeeded,
  initialContent = '',
  isEditing = false,
  showAttachments = false,
  placeholder,
  minHeight = '100px',
  showToolbar = true,
  showSubmitButtons = true,
  submitButtonText,
  cancelButtonText,
  toolbarOptions = defaultToolbarOptions,
  variant = 'full',
  className = '',
  editorClassName = '',
  resizable = true,
  compact = false,
  attachmentContext = 'comment',
  attachmentParentId,
  existingAttachments = [],
  // Image behavior control props with defaults
  allowImagePaste = true,
  allowImageDelete = true,
  allowImageResize = true,
  imageDisplayMode = 'full',
  editable = true,
  maxLength,
}: TextEditorProps) {
  const { t } = useTranslation('common');
  const { siteSettings } = useSettings();
  // Default to true if setting is undefined (matches current behavior)
  const opensInNewTab = siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true';
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [hasSelectedText, setHasSelectedText] = useState(false);
  const [isEditingExistingLink, setIsEditingExistingLink] = useState(false);
  const [openInNewWindow, setOpenInNewWindow] = useState(opensInNewTab);
  const [showHeadingDropdown, setShowHeadingDropdown] = useState(false);
  const [showTableDropdown, setShowTableDropdown] = useState(false);

  useEscapeDismiss(
    () => {
      setShowLinkDialog(false);
      setLinkUrl('');
      setLinkText('');
      setHasSelectedText(false);
      setIsEditingExistingLink(false);
      setOpenInNewWindow(opensInNewTab);
    },
    { enabled: showLinkDialog }
  );

  // Handle both new files and existing attachments
  const [newAttachments, setNewAttachments] = useState<File[]>([]);
  const [displayedAttachments, setDisplayedAttachments] = useState<Array<{
    id: string;
    name: string;
    url?: string;
    type: string;
    size: number;
    isNew?: boolean;
    file?: File;
  }>>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const headingDropdownRef = React.useRef<HTMLDivElement>(null);
  const tableDropdownRef = React.useRef<HTMLDivElement>(null);
  // TipTap HTML after last programmatic setContent / create — used to ignore non-user updates
  const contentBaselineRef = React.useRef<string | null>(null);
  const maxLengthRef = React.useRef<number | undefined>(maxLength);
  maxLengthRef.current = maxLength;

  // Track previous existingAttachments to prevent infinite updates
  const prevExistingAttachmentsRef = React.useRef<string>('');
  
  // Sync openInNewWindow checkbox with siteSettings when it changes
  useEffect(() => {
    setOpenInNewWindow(opensInNewTab);
  }, [opensInNewTab]);
  
  // Initialize displayed attachments when existingAttachments changes
  React.useEffect(() => {
    const currentKey = JSON.stringify(existingAttachments.map(att => att.id).sort());
    
    // Only update if the attachments actually changed
    if (prevExistingAttachmentsRef.current !== currentKey) {
      prevExistingAttachmentsRef.current = currentKey;
      setDisplayedAttachments(prev => {
        // When parent attachments change, trust the parent's state completely
        // Only keep "New" attachments if they're truly new and not represented in parent
        const existingNames = existingAttachments.map(att => att.name);
        const newAttachmentsToKeep = prev.filter(att => 
          att.isNew && 
          !existingNames.includes(att.name) &&
          att.file // Only keep if it's actually a new file being uploaded
        );
        
        const newDisplayed = [
          ...existingAttachments.map(att => ({ ...att, isNew: false })),
          ...newAttachmentsToKeep
        ];
        return newDisplayed;
      });
    }
  }, [existingAttachments]);

  // Determine base toolbar options based on variant and compact mode
  const baseToolbarOptions = compact
    ? { // Compact mode (existing behavior)
        bold: true,
        italic: true,
        underline: false,
        strikethrough: false,
        heading: false,
        code: false,
        codeBlock: false,
        table: false,
        link: true,
        lists: true,
        alignment: false,
        attachments: false
      }
    : variant === 'full'
      ? fullToolbarOptions // Full variant (TaskDetails/TaskPage)
      : inlineToolbarOptions; // Inline variant (TaskCard/ListView)
  
  const finalToolbarOptions = { ...baseToolbarOptions, ...toolbarOptions };

  // Compact styling
  const buttonClass = compact ? 'p-1' : 'p-2';
  const iconSize = compact ? 14 : 16;

  // Generate unique filename for pasted images
  const generateImageFilename = React.useCallback((file: File): string => {
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = file.type.includes('png') ? 'png' : 
                     file.type.includes('jpg') || file.type.includes('jpeg') ? 'jpg' :
                     file.type.includes('gif') ? 'gif' :
                     file.type.includes('webp') ? 'webp' : 'png';
    return `img-${randomId}.${extension}`;
  }, []);


  // Fix blob URLs in initial content - using same logic as TaskCard
  const fixImageUrls = (htmlContent: string, attachments: any[]) => {
    let fixedContent = htmlContent;
    attachments.forEach(attachment => {
      if (attachment.name.startsWith('img-')) {
        // Replace blob URLs with authenticated server URLs
        const blobPattern = new RegExp(`blob:[^"]*#${attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        const authenticatedUrl = getAuthenticatedAttachmentUrl(attachment.url);
        fixedContent = fixedContent.replace(blobPattern, authenticatedUrl || attachment.url);
      }
    });
    return fixedContent;
  };

  const getFixedInitialContent = () => {
    if (!initialContent) return initialContent;
    
    // Fix blob URLs with existing attachments
    return fixImageUrls(initialContent, existingAttachments);
  };

  const editor = useEditor({
    autofocus: compact ? 'end' : false,
    extensions: [
      StarterKit.configure({
        // Disable the default list extensions from StarterKit
        bulletList: false,
        orderedList: false,
        listItem: false,
        // Disable heading from StarterKit since we'll add it explicitly
        heading: false,
        // Disable strike and code from StarterKit since we'll add them explicitly
        strike: false,
        code: false,
        codeBlock: false,
      }),
      // Add explicit list extensions with proper configuration
      BulletList.configure({
        keepMarks: true,
        keepAttributes: false,
        HTMLAttributes: {
          class: 'tiptap-bullet-list',
        },
      }),
      OrderedList.configure({
        keepMarks: true,
        keepAttributes: false,
        HTMLAttributes: {
          class: 'tiptap-ordered-list',
        },
      }),
      ListItem.configure({
        HTMLAttributes: {
          class: 'tiptap-list-item',
        },
      }),
      Underline,
      Strike,
      Code,
      CodeBlock,
      Heading.configure({
        levels: [1, 2, 3, 4, 5, 6],
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        openOnClick: false, // We'll handle clicks manually
        HTMLAttributes: {
          class: 'text-blue-500 hover:text-blue-700 underline cursor-pointer',
          rel: 'noopener noreferrer',
          // target will be set dynamically based on SITE_OPENS_NEW_TAB setting
          ...(opensInNewTab ? { target: '_blank' } : {})
        },
        protocols: ['http', 'https', 'mailto'],
        validate: href => /^https?:\/\//.test(href)
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph']
      }),
      Image.extend({
        name: 'resizableImage',
        addAttributes() {
          return {
            ...this.parent?.(),
            'data-border': {
              default: null,
              parseHTML: element => element.getAttribute('data-border'),
              renderHTML: attributes => {
                if (!attributes['data-border']) {
                  return {};
                }
                return {
                  'data-border': attributes['data-border'],
                };
              },
            },
            width: {
              default: null,
              parseHTML: element => element.getAttribute('width'),
              renderHTML: attributes => {
                if (!attributes.width) {
                  return {};
                }
                return {
                  width: attributes.width,
                };
              },
            },
          };
        },
        addNodeView() {
          return ({ node, updateAttributes, getPos, editor }) => {
            // Access the outer component's state through a closure
            const container = document.createElement('div');
            container.className = 'tiptap-image-container relative inline-block';
            
            const img = document.createElement('img');
            img.src = node.attrs.src;
            img.className = 'tiptap-image block';
            // Add compact data attribute for CSS styling
            if (imageDisplayMode === 'compact') {
              img.setAttribute('data-compact', 'true');
            }
            img.style.width = node.attrs.width || (imageDisplayMode === 'compact' ? '150px' : '300px');
            img.style.height = 'auto';
            img.style.borderRadius = '4px';
            img.style.cursor = 'pointer';
            
            // Make image non-selectable if deletion is not allowed
            if (!allowImageDelete) {
              img.style.userSelect = 'none';
              img.style.pointerEvents = 'none';
              img.draggable = false;
            }
            
            // Apply existing border styles if any
            if (node.attrs['data-border']) {
              img.style.border = node.attrs['data-border'];
            }
            
            // Border options popup
            const createBorderOptions = () => {
              // Remove any existing popup
              const existingPopup = document.querySelector('.border-options-popup');
              if (existingPopup) {
                existingPopup.remove();
              }
              
              const popup = document.createElement('div');
              popup.className = 'border-options-popup absolute z-20 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg p-2';
              popup.style.cssText = 'top: 100%; left: 0; min-width: 200px; margin-top: 4px;';
              
              const borderOptions = [
                { label: i18n.t('textEditor.borderNoBorder', { ns: 'common' }), value: 'none' },
                { label: i18n.t('textEditor.borderThinBlack', { ns: 'common' }), value: '1px solid #000' },
                { label: i18n.t('textEditor.borderThickBlack', { ns: 'common' }), value: '3px solid #000' },
                { label: i18n.t('textEditor.borderThinGray', { ns: 'common' }), value: '1px solid #666' },
                { label: i18n.t('textEditor.borderThinBlue', { ns: 'common' }), value: '2px solid #3b82f6' },
                { label: i18n.t('textEditor.borderDashedGray', { ns: 'common' }), value: '2px dashed #666' },
                { label: i18n.t('textEditor.borderDottedBlue', { ns: 'common' }), value: '2px dotted #3b82f6' }
              ];
              
              borderOptions.forEach(option => {
                const button = document.createElement('button');
                button.textContent = option.label;
                button.className = 'block w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded';
                button.onclick = (e) => {
                  e.stopPropagation();
                  
                  // Update the image border
                  const borderStyle = option.value === 'none' ? '' : option.value;
                  img.style.border = borderStyle;
                  
                  // Update the node attributes
                  try {
                    const pos = getPos();
                    if (pos !== undefined && editor) {
                      // Use the editor's transaction system to update attributes
                      const tr = editor.state.tr;
                      const newAttrs = {
                        ...node.attrs,
                        'data-border': borderStyle || null
                      };
                      tr.setNodeMarkup(pos, undefined, newAttrs);
                      editor.view.dispatch(tr);
                      
                    } else if (updateAttributes && typeof updateAttributes === 'function') {
                      // Fallback to the provided updateAttributes function
                      updateAttributes({ 
                        'data-border': borderStyle || null
                      });
                    }
                  } catch (error) {
                    console.warn('Could not update image attributes:', error);
                  }
                  
                  popup.remove();
                };
                popup.appendChild(button);
              });
              
              // Close popup when clicking outside
              const closePopup = (e: Event) => {
                if (!popup.contains(e.target as Node)) {
                  popup.remove();
                  document.removeEventListener('click', closePopup);
                }
              };
              
              setTimeout(() => {
                document.addEventListener('click', closePopup);
              }, 100);
              
              container.appendChild(popup);
            };
            
            // Click handler for border options
            img.onclick = (e) => {
              e.stopPropagation();
              createBorderOptions();
            };
            
            // Delete button (only if deletion is allowed)
            let deleteBtn: HTMLButtonElement | null = null;
            if (allowImageDelete) {
              deleteBtn = document.createElement('button');
              deleteBtn.innerHTML = '×';
              deleteBtn.className = 'absolute bg-red-500 text-white rounded-full text-xs hover:bg-red-600 flex items-center justify-center z-10';
              deleteBtn.style.cssText = 'display: none; width: 18px; height: 18px; top: -6px; right: -6px; font-size: 12px; line-height: 1;';
              deleteBtn.onclick = (e) => {
                e.preventDefault();
                
                // STEP 1: Remove image from editor immediately
                const pos = getPos();
                if (typeof pos === 'number') {
                  editor.commands.deleteRange({ from: pos, to: pos + 1 });
                }
                
                // STEP 2: Extract filename for deletion
                const imageFilename = node.attrs['data-filename'] || node.attrs.alt;
                if (imageFilename) {
                  
                  // STEP 3: Clean up local state immediately
                  setNewAttachments(prev => prev.filter(att => att.name !== imageFilename));
                  setDisplayedAttachments(prev => prev.filter(att => att.name !== imageFilename));
                  
                  // STEP 4: Use the global cleanup function to handle server deletion
                  if (onImageRemovalNeeded) {
                    onImageRemovalNeeded(imageFilename);
                  }
                }
              };
            }
            
            // Resize handle (only if resizing is allowed)
            let resizeHandle: HTMLDivElement | null = null;
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;
            let handleMouseMove: ((e: MouseEvent) => void) | null = null;
            let handleMouseUp: (() => void) | null = null;
            
            if (allowImageResize) {
              resizeHandle = document.createElement('div');
              resizeHandle.className = 'absolute bg-blue-500 cursor-se-resize rounded-tl-md z-10';
              resizeHandle.style.cssText = 'display: none; width: 12px; height: 12px; bottom: -2px; right: -2px;';
              
              // Define the event handlers outside so they can be cleaned up
              handleMouseMove = (e: MouseEvent) => {
                if (!isResizing) return;
                const width = startWidth + (e.clientX - startX);
                const newWidth = Math.max(100, Math.min(800, width));
                img.style.width = newWidth + 'px';
                
                // Update the node attributes using the editor transaction system
                try {
                  const pos = getPos();
                  if (pos !== undefined && editor) {
                    const tr = editor.state.tr;
                    const newAttrs = {
                      ...node.attrs,
                      width: newWidth + 'px'
                    };
                    tr.setNodeMarkup(pos, undefined, newAttrs);
                    editor.view.dispatch(tr);
                  } else if (updateAttributes && typeof updateAttributes === 'function') {
                    // Fallback to the provided updateAttributes function
                    updateAttributes({ width: newWidth + 'px' });
                  }
                } catch (error) {
                  console.warn('⚠️ Failed to update image attributes during resize:', error);
                }
              };
              
              handleMouseUp = () => {
                isResizing = false;
                if (handleMouseMove) document.removeEventListener('mousemove', handleMouseMove);
                if (handleMouseUp) document.removeEventListener('mouseup', handleMouseUp);
              };
              
              resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isResizing = true;
                startX = e.clientX;
                startWidth = parseInt(window.getComputedStyle(img).width, 10);
                
                if (handleMouseMove) document.addEventListener('mousemove', handleMouseMove);
                if (handleMouseUp) document.addEventListener('mouseup', handleMouseUp);
              });
            }
            
            // Show/hide controls on hover
            container.addEventListener('mouseenter', () => {
              if (deleteBtn) deleteBtn.style.display = 'flex';
              if (resizeHandle) resizeHandle.style.display = 'block';
            });
            
            container.addEventListener('mouseleave', () => {
              if (!isResizing) {
                if (deleteBtn) deleteBtn.style.display = 'none';
                if (resizeHandle) resizeHandle.style.display = 'none';
              }
            });
            
            container.appendChild(img);
            if (deleteBtn) container.appendChild(deleteBtn);
            if (resizeHandle) container.appendChild(resizeHandle);
            
            return {
              dom: container,
              update: (updatedNode) => {
                if (updatedNode.type.name !== 'resizableImage') return false;
                img.src = updatedNode.attrs.src;
                img.style.width = updatedNode.attrs.width || '300px';
                return true;
              },
              destroy: () => {
                // Clean up event listeners when the node is destroyed
                if (isResizing) {
                  if (handleMouseMove) document.removeEventListener('mousemove', handleMouseMove);
                  if (handleMouseUp) document.removeEventListener('mouseup', handleMouseUp);
                  isResizing = false;
                }
              }
            };
          };
        }
      }).configure({
        HTMLAttributes: {
          class: 'tiptap-image',
        },
        allowBase64: false,
        // Include data-border-style in the rendered HTML
        renderHTML({ HTMLAttributes }) {
          // Add style attribute if data-border exists
          const finalAttributes = { ...HTMLAttributes };
          if (HTMLAttributes['data-border']) {
            finalAttributes.style = `border: ${HTMLAttributes['data-border']};`;
          }
          return ['img', finalAttributes];
        },
      })
    ],
    content: getFixedInitialContent(),
    editable,
    onCreate: ({ editor }) => {
      contentBaselineRef.current = editor.getHTML();
    },
    onBlur: ({ editor }) => {
      // Flush latest HTML to parent before focus moves (e.g. Save button click)
      if (!onChange || !editable) return;
      const content = editor.getHTML();
      if (contentBaselineRef.current !== null && content === contentBaselineRef.current) {
        return;
      }
      contentBaselineRef.current = content;
      onChange(content);
    },
    onUpdate: ({ editor, transaction }) => {
      const max = maxLengthRef.current;
      if (max && transaction.docChanged && editor.getHTML().length > max) {
        editor.commands.undo();
        return;
      }
      if (!onChange) return;
      const content = editor.getHTML();
      // Ignore updates that don't change content relative to the last programmatic baseline
      // (e.g. setEditable emitting 'update' on mount with the same document).
      if (contentBaselineRef.current !== null && content === contentBaselineRef.current) {
        return;
      }
      contentBaselineRef.current = content;
      onChange(content);
    },
    editorProps: {
      attributes: {
        class: `text-editor-prosemirror prose prose-sm max-w-none focus:outline-none ${compact ? 'px-2 py-1' : 'px-3 py-2'} ${editorClassName}`,
        style: `min-height: ${compact ? '60px' : minHeight}; word-break: break-word; overflow-wrap: break-word;`,
        placeholder: placeholder || t('textEditor.placeholder')
      },
      handleClick: (view, pos, event) => {
        // Check if Ctrl (Windows/Linux) or Cmd (Mac) is pressed
        const isModifierPressed = event.ctrlKey || event.metaKey;
        
        if (isModifierPressed) {
          // Get the node at the clicked position
          const { doc, schema } = view.state;
          const $pos = doc.resolve(pos);
          
          // Check if we clicked on a link
          const link = $pos.marks().find(mark => mark.type === schema.marks.link);
          
          if (link && link.attrs.href) {
            // Prevent default editor behavior
            event.preventDefault();
            event.stopPropagation();
            
            // Open the link based on SITE_OPENS_NEW_TAB setting
            if (opensInNewTab) {
              window.open(link.attrs.href, '_blank', 'noopener,noreferrer');
            } else {
              window.location.href = link.attrs.href;
            }
            return true; // Handled
          }
        }
        
        return false; // Not handled, let editor handle normally
      },
      handleKeyDown: (view, event) => {
        // Prevent image deletion via keyboard when allowImageDelete is false
        if (!allowImageDelete) {
          const { state } = view;
          const { selection } = state;
          const { $from, $to } = selection;
          
          // For specific deletion keys (Backspace, Delete)
          if (event.key === 'Backspace' || event.key === 'Delete') {
            const nodeAfter = $from.nodeAfter;
            const nodeBefore = $from.nodeBefore;
            
            // For Backspace: check node before cursor
            if (event.key === 'Backspace' && nodeBefore && nodeBefore.type.name === 'resizableImage') {
              event.preventDefault();
              return true;
            }
            
            // For Delete: check node after cursor  
            if (event.key === 'Delete' && nodeAfter && nodeAfter.type.name === 'resizableImage') {
              event.preventDefault();
              return true;
            }
          }
          
          // Prevent ANY key that would replace selected content when image is selected
          if (!selection.empty) {
            let hasSelectedImage = false;
            state.doc.nodesBetween(selection.from, selection.to, (node) => {
              if (node.type.name === 'resizableImage') {
                hasSelectedImage = true;
                return false; // Stop iteration
              }
            });
            
            if (hasSelectedImage) {
              // Prevent any key that would replace the selection (including Shift+Enter, typing, etc.)
              event.preventDefault();
              return true;
            }
          }
        }
        
        // Handle Escape key for compact mode
        if (compact && event.key === 'Escape' && onCancel) {
          event.preventDefault();
          onCancel();
          return true;
        }
        
        // Handle Enter key for compact mode (save)
        if (compact && event.key === 'Enter' && !event.shiftKey && onSubmit && editor) {
          // Don't save if we're in a list - let TipTap handle list item creation
          const { $from } = view.state.selection;
          const isInList = $from.parent.type.name === 'listItem' || 
                          editor.isActive('bulletList') || 
                          editor.isActive('orderedList');
          
          if (!isInList) {
            event.preventDefault();
            onSubmit(editor.getHTML() || '', []);
            return true;
          }
        }
        
        return false;
      }
    }
  });

  // Update editor content when existingAttachments change (e.g., when they're loaded)
  useEffect(() => {
    if (editor && existingAttachments.length > 0 && initialContent?.includes('img-')) {
      // Don't overwrite while the user is typing
      if (editor.isFocused) return;
      const fixedContent = getFixedInitialContent();
      if (fixedContent !== initialContent && fixedContent !== editor.getHTML()) {
        // emitUpdate=false: do not treat URL fixes as user edits
        editor.commands.setContent(fixedContent, false);
        contentBaselineRef.current = editor.getHTML();
      }
    }
  }, [existingAttachments, initialContent, editor]);

  // Update editor content when initialContent prop changes from an external source
  // (task switch, websocket). Skip while focused so parent onChange echo cannot
  // reset the document mid-edit and break autosave.
  React.useEffect(() => {
    if (editor && initialContent !== undefined) {
      if (editor.isFocused) return;
      const currentContent = editor.getHTML();
      if (currentContent !== initialContent) {
        console.log('🔄 TextEditor: initialContent changed, updating editor content');
        console.log('🔄 From:', currentContent.substring(0, 100) + '...');
        console.log('🔄 To:', initialContent.substring(0, 100) + '...');
        // emitUpdate=false: prop sync must not mark the parent form dirty
        editor.commands.setContent(initialContent, false);
        contentBaselineRef.current = editor.getHTML();
      }
    }
  }, [editor, initialContent]);

  React.useEffect(() => {
    if (editor && !editor.isDestroyed) {
      // Second arg false: setEditable emits 'update' by default and would falsely
      // trigger onChange → "Unsaved changes" as soon as the editor mounts.
      editor.setEditable(editable, false);
    }
  }, [editor, editable]);

  // Handle pasted images
  const handleImagePaste = React.useCallback(async (file: File): Promise<void> => {
    // Check if image pasting is allowed
    if (!allowImagePaste) {
      console.log('🚫 Image pasting disabled in this editor mode');
      return;
    }
    
    try {
      // Generate unique filename and attachment ID
      const filename = generateImageFilename(file);
      const attachmentId = `temp-${Date.now()}-${Math.random()}`;
      
      // Create a temporary blob URL for immediate display
      const tempUrl = URL.createObjectURL(file);
      
      if (!editor) {
        console.error('❌ Editor not available');
        return;
      }
      
      // Add the image to the editor immediately with temp URL
      // Store filename in the URL itself to survive content updates
      const urlWithFilename = `${tempUrl}#${filename}`;
      editor.chain().focus().insertContent({
        type: 'resizableImage',
        attrs: {
          src: urlWithFilename,
          'data-filename': filename,
          'data-attachment-id': attachmentId,
          'data-temp': 'true',
          width: imageDisplayMode === 'compact' ? '150px' : '300px',
          alt: filename // Also store in alt attribute as backup
        }
      }).run();
      
      console.log('✅ Image pasted:', filename);
      
      // Create a new File object with the generated filename to avoid "image.png" duplication
      const renamedFile = new File([file], filename, { type: file.type });
      
      // Add to attachments for later upload
      const updatedAttachments = [...newAttachments, renamedFile];
      setNewAttachments(updatedAttachments);
      
      // Add to displayed attachments
      const newDisplayedAttachment = {
        id: attachmentId,
        name: filename,
        type: file.type,
        size: file.size,
        isNew: true,
        file: renamedFile
      };
      
      setDisplayedAttachments(prev => [...prev, newDisplayedAttachment]);
      
      // Notify parent component
      if (onAttachmentsChange) {
        onAttachmentsChange(updatedAttachments);
      }
      
    } catch (error) {
      console.error('❌ Error handling pasted image:', error);
    }
  }, [editor, generateImageFilename]);

  // Function to remove images from editor when attachments are deleted
  const removeImageByAttachment = React.useCallback((attachmentName: string) => {
    if (!editor) {
      console.log('❌ removeImageByAttachment: Editor not available');
      return;
    }
    
    
    // Find and remove images with matching filename
    const { doc } = editor.state;
    const ranges: { from: number; to: number }[] = [];
    
    doc.descendants((node, pos) => {
      if (node.type.name === 'resizableImage') {
        const nodeFilename = node.attrs['data-filename'];
        const nodeAlt = node.attrs.alt;
        const nodeSrc = node.attrs.src;
        
        
        // Check multiple sources for filename match
        const matches = 
          nodeFilename === attachmentName ||
          nodeAlt === attachmentName ||
          (nodeSrc && nodeSrc.includes(`#${attachmentName}`)) ||
          (nodeSrc && nodeSrc.includes(attachmentName));
          
        if (matches) {
          console.log('✅ Image matches, will remove');
          ranges.push({ from: pos, to: pos + node.nodeSize });
        }
      }
    });
    
    // Remove images in reverse order to maintain positions
    ranges.reverse().forEach(range => {
      editor.commands.deleteRange(range);
    });
    
    if (ranges.length === 0) {
      console.log(`❌ removeImageByAttachment: No images found to remove for: ${attachmentName}`);
    } else {
      console.log(`🗑️ removeImageByAttachment: Removed ${ranges.length} image(s) for attachment: ${attachmentName}`);
    }
  }, [editor]);

  // Provide helpers for parent (TaskDetails) to sync attachment UI after upload failures
  const discardPendingAttachments = React.useCallback((names?: string[]) => {
    const nameSet = names && names.length > 0 ? new Set(names) : null;

    setNewAttachments((prev) => {
      const removed = nameSet ? prev.filter((f) => nameSet.has(f.name)) : [...prev];
      removed.forEach((f) => removeImageByAttachment(f.name));
      const next = nameSet ? prev.filter((f) => !nameSet.has(f.name)) : [];
      if (onAttachmentsChange) {
        onAttachmentsChange(next);
      }
      return next;
    });

    setDisplayedAttachments((prev) =>
      nameSet
        ? prev.filter((a) => !(a.isNew && nameSet.has(a.name)))
        : prev.filter((a) => !a.isNew)
    );
  }, [onAttachmentsChange, removeImageByAttachment]);

  React.useEffect(() => {
    (window as any).textEditorRemoveImage = removeImageByAttachment;
    (window as any).textEditorDiscardPendingAttachments = discardPendingAttachments;
    return () => {
      delete (window as any).textEditorRemoveImage;
      delete (window as any).textEditorDiscardPendingAttachments;
    };
  }, [removeImageByAttachment, discardPendingAttachments]);

  // Handle paste events for images
  React.useEffect(() => {
    if (!editor) return;

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          console.log('🖼️ Image paste detected:', item.type);
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            handleImagePaste(file);
          }
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('paste', handlePaste);
    console.log('📋 Paste event listener added to editor');

    return () => {
      editorElement.removeEventListener('paste', handlePaste);
      console.log('📋 Paste event listener removed');
    };
  }, [editor, handleImagePaste]);

  // Handle clicks in empty space to move cursor to end
  const handleEditorContainerClick = React.useCallback((event: React.MouseEvent) => {
    if (!editor) return;
    
    const target = event.target as HTMLElement;
    const clickY = event.clientY;
    
    // Check if we're clicking in the editor area
    const editorElement = editor.view.dom;
    if (!editorElement.contains(target)) return;
    
    // Get the bounds of the actual content
    const children = editorElement.children;
    
    if (children.length > 0) {
      const lastChild = children[children.length - 1] as HTMLElement;
      const lastChildRect = lastChild.getBoundingClientRect();
      
      // If clicking below the last content element (with some tolerance), move cursor to end
      if (clickY > lastChildRect.bottom + 5) {
        event.preventDefault();
        editor.commands.focus('end');
        console.log('📍 Moved cursor to end due to empty space click');
      }
    } else {
      // If no content at all, always move to end
      editor.commands.focus('end');
    }
  }, [editor]);

  // Handle outside clicks for compact mode (moved after useEditor)
  React.useEffect(() => {
    if (!compact || !onSubmit || !editor) return;

    const handleClickOutside = (event: MouseEvent) => {
      // Safety checks
      if (!event.target || !editorRef.current) return;
      
      try {
        if (!editorRef.current.contains(event.target as Node)) {
          // Save and close when clicking outside
          const content = editor.getHTML();
          onSubmit(content, []);
        }
      } catch (error) {
        console.error('Error in handleClickOutside:', error);
      }
    };

    // Add a small delay to ensure editor is fully initialized
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [compact, onSubmit, editor]);

  // Handle outside clicks for heading dropdown
  React.useEffect(() => {
    if (!showHeadingDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (headingDropdownRef.current && !headingDropdownRef.current.contains(event.target as Node)) {
        setShowHeadingDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHeadingDropdown]);

  // Handle outside clicks for table dropdown
  React.useEffect(() => {
    if (!showTableDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (tableDropdownRef.current && !tableDropdownRef.current.contains(event.target as Node)) {
        setShowTableDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTableDropdown]);

  const handleLinkSubmit = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor || !linkUrl.trim()) return;

    // Ensure URL has a protocol
    let formattedUrl = linkUrl.trim();
    if (!formattedUrl.match(/^https?:\/\//)) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Adding link:', { hasSelectedText, formattedUrl, linkText, openInNewWindow, isEditingExistingLink });

    // Build link attributes based on options
    const linkAttributes: any = { href: formattedUrl };
    if (openInNewWindow) {
      linkAttributes.target = '_blank';
      linkAttributes.rel = 'noopener noreferrer';
    }
    
    console.log('Link attributes:', linkAttributes);

    if (isEditingExistingLink) {
      // We're editing an existing link - update it directly
      console.log('Updating existing link with attributes:', linkAttributes);
      
      // Extend the selection to cover the entire link mark and then update it
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink(linkAttributes)
        .run();
      
      console.log('Link updated, checking if active:', editor.isActive('link'));
      console.log('Current selection:', editor.state.selection);
      console.log('Editor HTML after update:', editor.getHTML());
    } else if (hasSelectedText) {
      // Text was selected when dialog opened - add link to selection
      console.log('Adding link to selected text');
      editor.chain().focus().setLink(linkAttributes).run();
    } else {
      // No text was selected - insert new text with link
      const textToInsert = linkText.trim() || formattedUrl;
      console.log('Inserting new linked text:', textToInsert);
      
      // Build HTML attributes string
      const targetAttr = openInNewWindow ? ' target="_blank" rel="noopener noreferrer"' : '';
      
      // Use a simpler approach - insert content with link in one go
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${formattedUrl}" class="text-blue-500 hover:text-blue-700 underline"${targetAttr}>${textToInsert}</a>`)
        .run();
    }

    setShowLinkDialog(false);
    setLinkUrl('');
    setLinkText('');
    setHasSelectedText(false);
    setIsEditingExistingLink(false);
    setOpenInNewWindow(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newFiles = Array.from(files);
      const updatedAttachments = [...newAttachments, ...newFiles];
      setNewAttachments(updatedAttachments);
      
      // Add to displayed attachments for immediate UI feedback
      const newDisplayedAttachments = newFiles.map(file => ({
        id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID
        name: file.name,
        type: file.type,
        size: file.size,
        isNew: true,
        file
      }));
      
      setDisplayedAttachments(prev => [...prev, ...newDisplayedAttachments]);
      
      // Notify parent component about attachment changes
      if (onAttachmentsChange) {
        onAttachmentsChange(updatedAttachments);
      }
    }
  };

  const handleSubmit = async () => {
    if (!editor) return;
    
    const content = editor.getHTML();
    if (maxLength && content.length > maxLength) {
      return;
    }
    const isEmptyContent = !content || content.replace(/<[^>]*>/g, '').trim() === '';
    
    if (!isEmptyContent || (showAttachments && newAttachments.length > 0)) {
      try {
        // Only pass new attachments to onSubmit - existing ones are already saved
        await onSubmit(content, showAttachments ? [...newAttachments] : undefined);
        editor.commands.clearContent();
        setNewAttachments([]);
        setDisplayedAttachments(existingAttachments.map(att => ({ ...att, isNew: false })));
      } catch (error) {
        console.error('Failed to submit content:', error);
      }
    }
  };

  const handleCancel = () => {
    if (editor) {
      editor.commands.clearContent();
    }
    setNewAttachments([]);
    setDisplayedAttachments(existingAttachments.map(att => ({ ...att, isNew: false })));
    onCancel?.();
  };

  if (!editor) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          .text-editor-prosemirror {
            color: #1f2937; /* text-gray-800 */
          }
          .dark .text-editor-prosemirror {
            color: #f3f4f6; /* text-gray-100 */
          }
          .text-editor-prosemirror p {
            margin: 0.5rem 0;
          }
          .text-editor-prosemirror p:first-child {
            margin-top: 0;
          }
          .text-editor-prosemirror p:last-child {
            margin-bottom: 0;
          }
          .text-editor-prosemirror h1 {
            font-size: 2em;
            font-weight: bold;
            margin: 0.75rem 0;
            line-height: 1.2;
          }
          .text-editor-prosemirror h2 {
            font-size: 1.5em;
            font-weight: bold;
            margin: 0.67rem 0;
            line-height: 1.3;
          }
          .text-editor-prosemirror h3 {
            font-size: 1.25em;
            font-weight: 600;
            margin: 0.5rem 0;
            line-height: 1.4;
          }
          .text-editor-prosemirror h4 {
            font-size: 1.1em;
            font-weight: 500;
            margin: 0.5rem 0;
            line-height: 1.4;
          }
          .text-editor-prosemirror ul, .text-editor-prosemirror ol {
            padding-left: 1.5rem;
          }
          .text-editor-prosemirror li {
            margin: 0.25rem 0;
          }
          .text-editor-prosemirror a {
            color: #3b82f6; /* text-blue-500 */
            text-decoration: underline;
          }
          .dark .text-editor-prosemirror a {
            color: #60a5fa; /* text-blue-400 */
          }
          .text-editor-prosemirror strong {
            font-weight: 600;
          }
          .text-editor-prosemirror em {
            font-style: italic;
          }
          .text-editor-prosemirror u {
            text-decoration: underline;
          }
          .text-editor-prosemirror s {
            text-decoration: line-through;
          }
          .text-editor-prosemirror code {
            background-color: #f3f4f6;
            padding: 0.125rem 0.25rem;
            border-radius: 0.25rem;
            font-family: 'Courier New', Courier, monospace;
            font-size: 0.875em;
          }
          .dark .text-editor-prosemirror code {
            background-color: #374151;
          }
          .text-editor-prosemirror pre {
            background-color: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            padding: 0.75rem;
            margin: 0.5rem 0;
            overflow-x: auto;
          }
          .dark .text-editor-prosemirror pre {
            background-color: #1f2937;
            border-color: #4b5563;
          }
          .text-editor-prosemirror pre code {
            background-color: transparent;
            padding: 0;
            border-radius: 0;
            font-family: 'Courier New', Courier, monospace;
            font-size: 0.875rem;
          }
          .text-editor-prosemirror table {
            border-collapse: collapse;
            margin: 0.5rem 0;
            width: 100%;
            overflow: hidden;
          }
          .text-editor-prosemirror td,
          .text-editor-prosemirror th {
            border: 1px solid #d1d5db;
            padding: 0.5rem;
            position: relative;
            vertical-align: top;
          }
          .dark .text-editor-prosemirror td,
          .dark .text-editor-prosemirror th {
            border-color: #4b5563;
          }
          .text-editor-prosemirror th {
            background-color: #f3f4f6;
            font-weight: 600;
            text-align: left;
          }
          .dark .text-editor-prosemirror th {
            background-color: #374151;
          }
          .text-editor-prosemirror .selectedCell {
            background-color: #dbeafe;
          }
          .dark .text-editor-prosemirror .selectedCell {
            background-color: #1e3a8a;
          }
        `
      }} />
      <div 
        ref={editorRef}
        className={`${compact ? 'border border-gray-300 dark:border-gray-600 rounded' : 'border border-gray-300 dark:border-gray-600 rounded-lg'} overflow-hidden bg-white dark:bg-gray-800 ${className}`}
      >
      {/* Toolbar */}
      {showToolbar && (
        <div className={`flex flex-wrap gap-1 ${compact ? 'p-1' : 'p-2'} border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700`}>
          {/* Headers */}
          {finalToolbarOptions.heading && (
            <div className="relative" ref={headingDropdownRef}>
              <button
                type="button"
                onClick={() => setShowHeadingDropdown(!showHeadingDropdown)}
                className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-1 px-2`}
                title={t('textEditor.heading')}
              >
                <span className="text-xs font-semibold min-w-[24px]">
                  {editor.isActive('heading', { level: 1}) ? 'H1' :
                   editor.isActive('heading', { level: 2}) ? 'H2' :
                   editor.isActive('heading', { level: 3}) ? 'H3' :
                   editor.isActive('heading', { level: 4}) ? 'H4' :
                   editor.isActive('code') ? 'Pre' : 'P'}
                </span>
                <ChevronDown size={12} />
              </button>
              
              {showHeadingDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 py-1 min-w-[120px]">
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().setParagraph().run();
                      setShowHeadingDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().toggleHeading({ level: 1 }).run();
                      setShowHeadingDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 font-bold text-lg"
                  >
                    Heading 1
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().toggleHeading({ level: 2 }).run();
                      setShowHeadingDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 font-bold text-base"
                  >
                    Heading 2
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().toggleHeading({ level: 3 }).run();
                      setShowHeadingDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 font-semibold text-sm"
                  >
                    Heading 3
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().toggleHeading({ level: 4 }).run();
                      setShowHeadingDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium text-sm"
                  >
                    Heading 4
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().toggleCode().run();
                      setShowHeadingDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 font-mono text-xs"
                  >
                    Preformatted
                  </button>
                </div>
              )}
            </div>
          )}
          
          {/* Bold */}
          {finalToolbarOptions.bold && (
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-600' : ''
              }`}
              title={t('textEditor.bold')}
            >
              <Bold size={iconSize} />
            </button>
          )}
          
          {finalToolbarOptions.italic && (
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-600' : ''
              }`}
              title={t('textEditor.italic')}
            >
              <Italic size={iconSize} />
            </button>
          )}
          
          {finalToolbarOptions.underline && (
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                editor.isActive('underline') ? 'bg-gray-200 dark:bg-gray-600' : ''
              }`}
              title={t('textEditor.underline')}
            >
              <UnderlineIcon size={iconSize} />
            </button>
          )}
          
          {/* Strikethrough */}
          {finalToolbarOptions.strikethrough && (
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                editor.isActive('strike') ? 'bg-gray-200 dark:bg-gray-600' : ''
              }`}
              title={t('textEditor.strikethrough')}
            >
              <Strikethrough size={iconSize} />
            </button>
          )}
          
          {/* Lists */}
          {finalToolbarOptions.lists && (
            <>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                  editor.isActive('bulletList') ? 'bg-gray-200 dark:bg-gray-600' : ''
                }`}
                title={t('textEditor.bulletList')}
              >
                <List size={16} />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                  editor.isActive('orderedList') ? 'bg-gray-200 dark:bg-gray-600' : ''
                }`}
                title={t('textEditor.numberedList')}
              >
                <ListOrdered size={16} />
              </button>
            </>
          )}
          
          {/* Code Block */}
          {finalToolbarOptions.codeBlock && (
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                editor.isActive('codeBlock') ? 'bg-gray-200 dark:bg-gray-600' : ''
              }`}
              title={t('textEditor.codeBlock')}
            >
              <span className="text-xs font-mono font-bold">&lt;&gt;</span>
            </button>
          )}
          
          {/* Link */}
          {finalToolbarOptions.link && (
            <button
              type="button"
              onClick={() => {
                if (editor) {
                  const hasSelection = !editor.state.selection.empty;
                  const isOnLink = editor.isActive('link');
                  
                  if (isOnLink) {
                    // Cursor is on an existing link - get link attributes
                    const { from } = editor.state.selection;
                    const { doc, schema } = editor.state;
                    
                    // Find the link mark at the current position
                    const $pos = doc.resolve(from);
                    const linkMark = $pos.marks().find(mark => mark.type === schema.marks.link);
                    
                    if (linkMark) {
                      // Find the full extent of the link
                      let linkStart = from;
                      let linkEnd = from;
                      
                      // Expand backwards to find link start
                      while (linkStart > 0) {
                        const $prevPos = doc.resolve(linkStart - 1);
                        const prevLinkMark = $prevPos.marks().find(mark => 
                          mark.type === schema.marks.link && mark.attrs.href === linkMark.attrs.href
                        );
                        if (prevLinkMark) {
                          linkStart--;
                        } else {
                          break;
                        }
                      }
                      
                      // Expand forwards to find link end
                      while (linkEnd < doc.content.size) {
                        const $nextPos = doc.resolve(linkEnd);
                        const nextLinkMark = $nextPos.marks().find(mark => 
                          mark.type === schema.marks.link && mark.attrs.href === linkMark.attrs.href
                        );
                        if (nextLinkMark) {
                          linkEnd++;
                        } else {
                          break;
                        }
                      }
                      
                      // Select the entire link for editing
                      editor.chain().focus().setTextSelection({ from: linkStart, to: linkEnd }).run();
                      
                      // Get the link text and URL
                      const linkText = doc.textBetween(linkStart, linkEnd);
                      const linkUrl = linkMark.attrs.href;
                      
                      console.log('Editing existing link:', { linkUrl, linkText, linkStart, linkEnd });
                      
                      // Pre-populate the dialog
                      setLinkUrl(linkUrl);
                      setLinkText(linkText);
                      setHasSelectedText(true);
                      setIsEditingExistingLink(true);
                      
                      // Check if it opens in new window
                      const opensInNewWindow = linkMark.attrs.target === '_blank';
                      setOpenInNewWindow(opensInNewWindow);
                    }
                  } else {
                    // Normal behavior for new links
                    setHasSelectedText(hasSelection);
                    if (hasSelection) {
                      // Get the selected text to pre-fill the link text field
                      const selectedText = editor.state.doc.textBetween(
                        editor.state.selection.from,
                        editor.state.selection.to
                      );
                      setLinkText(selectedText);
                    } else {
                      setLinkText('');
                    }
                    setLinkUrl('');
                    setOpenInNewWindow(true);
                    setIsEditingExistingLink(false);
                  }
                }
                setShowLinkDialog(true);
              }}
              className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                editor.isActive('link') ? 'bg-gray-200 dark:bg-gray-600' : ''
              }`}
              title={editor?.isActive('link') ? t('textEditor.editLink') : t('textEditor.addLink')}
            >
              <Link2 size={iconSize} />
            </button>
          )}
          
          {(finalToolbarOptions.bold || finalToolbarOptions.italic || finalToolbarOptions.underline || finalToolbarOptions.link) && 
           (finalToolbarOptions.lists || finalToolbarOptions.alignment || finalToolbarOptions.attachments) && (
            <div className="w-px h-6 bg-gray-300 mx-1 self-center" />
          )}
          
          {/* Attachments */}
          {finalToolbarOptions.attachments && showAttachments && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
              title={t('textEditor.addAttachment')}
            >
              <Paperclip size={16} />
            </button>
          )}
          
          {/* Table Operations */}
          {finalToolbarOptions.table && (
            <div className="relative" ref={tableDropdownRef}>
              <button
                type="button"
                onClick={() => setShowTableDropdown(!showTableDropdown)}
                className={`${buttonClass} rounded hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-1 ${
                  editor.isActive('table') ? 'bg-gray-200 dark:bg-gray-600' : ''
                }`}
                title={t('textEditor.table')}
              >
                <TableIcon size={iconSize} />
                <ChevronDown size={12} />
              </button>
              
              {showTableDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 py-1 min-w-[180px]">
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                      setShowTableDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-semibold"
                  >
                    Insert Table (3×3)
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().toggleHeaderRow().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().toggleHeaderRow()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Toggle Header Row
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().mergeCells().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().mergeCells()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Merge Selected Cells
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().splitCell().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().splitCell()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Split Merged Cell
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().addColumnBefore().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().addColumnBefore()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Column Before
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().addColumnAfter().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().addColumnAfter()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Column After
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().deleteColumn().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().deleteColumn()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Column
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().addRowBefore().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().addRowBefore()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Row Before
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().addRowAfter().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().addRowAfter()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Row After
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().deleteRow().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().deleteRow()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Row
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().deleteTable().run();
                      setShowTableDropdown(false);
                    }}
                    disabled={!editor.can().deleteTable()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-red-600 dark:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Table
                  </button>
                </div>
              )}
            </div>
          )}
          
          {finalToolbarOptions.alignment && (
            <>
              {finalToolbarOptions.lists && (
                <div className="w-px h-6 bg-gray-300 mx-1 self-center" />
              )}
              <button
                type="button"
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                  editor.isActive({ textAlign: 'left' }) ? 'bg-gray-200 dark:bg-gray-600' : ''
                }`}
                title={t('textEditor.alignLeft')}
              >
                <AlignLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                  editor.isActive({ textAlign: 'center' }) ? 'bg-gray-200 dark:bg-gray-600' : ''
                }`}
                title={t('textEditor.alignCenter')}
              >
                <AlignCenter size={16} />
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                  editor.isActive({ textAlign: 'right' }) ? 'bg-gray-200 dark:bg-gray-600' : ''
                }`}
                title={t('textEditor.alignRight')}
              >
                <AlignRight size={16} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Editor Content */}
      <div 
        className={resizable ? "resize-y overflow-auto" : ""}
        style={{ cursor: 'text' }}
        onClick={(e) => {
          if (compact && editor && !editor.isFocused) {
            editor.commands.focus('end');
          }
          // Handle clicks in empty space
          handleEditorContainerClick(e);
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Attachments */}
      {showAttachments && displayedAttachments.length > 0 && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Attachments:</p>
          <div className="space-y-1">
            {displayedAttachments
              .filter((attachment, index, array) => {
                // Remove duplicates: keep only the first occurrence of each name
                // Prioritize existing attachments over new ones
                const firstIndex = array.findIndex(att => att.name === attachment.name);
                if (firstIndex !== index) {
                  // This is a duplicate - keep it only if it's existing and the first occurrence is new
                  const firstOccurrence = array[firstIndex];
                  return !attachment.isNew && firstOccurrence.isNew;
                }
                return true;
              })
              .map((attachment, index) => (
              <div key={attachment.id} className="flex items-center gap-2 text-sm">
                <Paperclip size={14} className="text-gray-500" />
                {attachment.url && !attachment.isNew ? (
                  <a
                    href={getAuthenticatedAttachmentUrl(attachment.url) || attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {attachment.name}
                  </a>
                ) : (
                  <span className="text-gray-700">{attachment.name}</span>
                )}
                {attachment.isNew ? (
                  <span className="text-xs text-blue-600 bg-blue-100 px-1 rounded">New</span>
                ) : (
                  <span className="text-xs text-green-600 bg-green-100 px-1 rounded">Saved</span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    console.log('🖱️ Attachment X clicked:', {
                      name: attachment.name,
                      id: attachment.id,
                      isNew: attachment.isNew,
                      type: attachment.type,
                      startsWithPending: attachment.id.startsWith('pending-'),
                      buttonType: attachment.isNew ? 'new' : 'existing'
                    });
                    
                    if (attachment.isNew) {
                      console.log('🆕 Processing NEW attachment deletion');
                      
                      // Remove from new attachments and displayed attachments
                      const updatedNewAttachments = newAttachments.filter(file => file.name !== attachment.name);
                      console.log('🔄 Filtered newAttachments:', {
                        before: newAttachments.length,
                        after: updatedNewAttachments.length,
                        removedName: attachment.name
                      });
                      
                      setNewAttachments(updatedNewAttachments);
                      setDisplayedAttachments(prev => prev.filter((_, i) => i !== index));
                      
                      // Notify parent of attachment changes
                      if (onAttachmentsChange) {
                        console.log('📞 Calling onAttachmentsChange with updated attachments');
                        onAttachmentsChange(updatedNewAttachments);
                      } else {
                        console.log('⚠️ No onAttachmentsChange handler provided');
                      }
                      
                      // CRITICAL: Also remove the image from the editor content!
                      console.log('🖼️ Removing image from editor for new attachment:', attachment.name);
                      removeImageByAttachment(attachment.name);
                    } else {
                      // For existing attachments, delete immediately from database
                      if (onAttachmentDelete && !attachment.id.startsWith('pending-')) {
                        try {
                          await onAttachmentDelete(attachment.id);
                          // Don't modify local state - let parent handle updates via existingAttachments
                          
                          // Also remove corresponding image from editor if it exists
                          console.log('🔄 Attachment deleted, removing image from editor:', attachment.name);
                          removeImageByAttachment(attachment.name);
                        } catch (error) {
                          console.error('Failed to delete attachment:', error);
                        }
                      } else {
                        // For new attachments, remove from display and newAttachments
                        setDisplayedAttachments(prev => prev.filter((_, i) => i !== index));
                        
                        // Update newAttachments and notify parent
                        setNewAttachments(prev => {
                          const updated = prev.filter(att => att.name !== attachment.name);
                          if (onAttachmentsChange) {
                            onAttachmentsChange(updated);
                          }
                          return updated;
                        });
                        
                        // Also remove corresponding image from editor if it exists
                        console.log('🔄 New attachment removed, removing image from editor:', attachment.name);
                        removeImageByAttachment(attachment.name);
                      }
                    }
                  }}
                  className="ml-auto text-gray-500 hover:text-gray-700"
                  title={attachment.isNew ? t('textEditor.removeAttachment') : t('textEditor.deleteAttachment')}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit Buttons */}
      {showSubmitButtons && (
        <div className="flex justify-end gap-2 p-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {onCancel && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
            >
              {cancelButtonText || t('buttons.cancel')}
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
          >
            <Check size={14} />
            {submitButtonText || t('textEditor.submit')}
          </button>
        </div>
      )}

      {/* Link Dialog */}
      {showLinkDialog && (
        <div 
          className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]"
          onClick={(e) => {
            e.stopPropagation();
            setShowLinkDialog(false);
            setLinkUrl('');
            setLinkText('');
            setHasSelectedText(false);
            setIsEditingExistingLink(false);
            setOpenInNewWindow(true);
          }}
        >
          <div 
            className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-3">
              {isEditingExistingLink 
                ? t('textEditor.editLink') 
                : hasSelectedText 
                  ? t('textEditor.addLinkToSelectedText') 
                  : t('textEditor.addLink')
              }
            </h3>
            <div>
              <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('textEditor.url')}
                </label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleLinkSubmit(e);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder={t('textEditor.urlPlaceholder')}
                  autoFocus
                />
              </div>
              {!hasSelectedText && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('textEditor.linkTextOptional')}
                  </label>
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleLinkSubmit(e);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder={t('textEditor.linkTextPlaceholder')}
                  />
                </div>
              )}
              {hasSelectedText && (
                <div className="mb-4 p-2 bg-gray-50 rounded border">
                  <span className="text-sm text-gray-600">{t('textEditor.selectedText')} </span>
                  <span className="text-sm font-medium">&ldquo;{linkText}&rdquo;</span>
                </div>
              )}
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm">
                  <ModernCheckbox
                    checked={openInNewWindow}
                    onChange={(e) => setOpenInNewWindow(e.target.checked)}
                    size="sm"
                  />
                  <span className="text-gray-700">{t('textEditor.openInNewWindow')}</span>
                </label>
              </div>
              <div className="flex justify-between">
                <div>
                  {isEditingExistingLink && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editor) {
                          editor.chain().focus().unsetLink().run();
                        }
                        setShowLinkDialog(false);
                        setLinkUrl('');
                        setLinkText('');
                        setHasSelectedText(false);
                        setIsEditingExistingLink(false);
                        setOpenInNewWindow(true);
                      }}
                      className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                    >
                      {t('textEditor.removeLink')}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowLinkDialog(false);
                      setLinkUrl('');
                      setLinkText('');
                      setHasSelectedText(false);
                      setIsEditingExistingLink(false);
                      setOpenInNewWindow(true);
                    }}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                  >
                    {t('buttons.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleLinkSubmit(e);
                    }}
                    className="px-4 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                  >
                    {isEditingExistingLink ? t('textEditor.updateLink') : t('textEditor.addLink')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden File Input */}
      {showAttachments && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
      )}

      {/* Styles for TipTap images */}
      <style>{`
        .tiptap-image {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          cursor: pointer;
          display: block;
          margin: 8px 0;
        }
        .tiptap-image:hover {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        .tiptap-image[data-temp="true"] {
          opacity: 0.8;
        }
      `}</style>
      </div>
    </>
  );
}

import React, { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  Link2, 
  Paperclip,
  List,
  ListOrdered,
  Check,
  X
} from 'lucide-react';
import { useFileUpload, createFileInput } from '../hooks/useFileUpload';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { formFieldClass, formMemoShellClass, formMemoToolbarClass } from '../utils/formFieldClasses';

interface CommentEditorProps {
  onSubmit: (content: string, attachments: File[]) => Promise<void>;
  onCancel?: () => void;
  initialContent?: string;
  isEditing?: boolean;
}

export default function CommentEditor({ onSubmit, onCancel, initialContent = '', isEditing = false }: CommentEditorProps) {
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  useEscapeDismiss(
    () => {
      setShowLinkDialog(false);
      setLinkUrl('');
      setLinkText('');
    },
    { enabled: showLinkDialog }
  );
  
  // Use the new file upload hook
  const {
    pendingFiles: attachments,
    isUploading,
    uploadError,
    addFiles,
    removeFile,
    clearFiles,
    handleFileInputChange,
    fileInputRef,
    validatePendingFiles
  } = useFileUpload();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 hover:text-blue-700 underline',
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      BulletList,
      OrderedList,
      ListItem,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[100px] p-3',
      },
    },
  });

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;

    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent(linkText)
        .setTextSelection(editor.state.selection.from - linkText.length)
        .setLink({ href: linkUrl })
        .run();
    } else {
      editor.chain().focus().setLink({ href: linkUrl }).run();
    }

    setShowLinkDialog(false);
    setLinkUrl('');
    setLinkText('');
  };

  const handleSubmit = async () => {
    if (!editor) return;
    
    const content = editor.getHTML();
    const isEmptyContent = !content || content.replace(/<[^>]*>/g, '').trim() === '';
    
    if (!isEmptyContent || attachments.length > 0) {
      try {
        // Validate files before submission
        const validation = validatePendingFiles();
        if (!validation.valid) {
          console.error('File validation failed:', validation.errors);
          return;
        }

        await onSubmit(content, [...attachments]);
        editor.commands.clearContent();
        clearFiles();
      } catch (error) {
        console.error('Failed to submit comment:', error);
      }
    }
  };

  if (!editor) return null;

  return (
    <div className={formMemoShellClass}>
      {/* Toolbar */}
      <div className={`flex items-center justify-between p-2 border-b ${formMemoToolbarClass}`}>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1 rounded ${editor.isActive('bold') ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1 rounded ${editor.isActive('italic') ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`p-1 rounded ${editor.isActive('underline') ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            <UnderlineIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowLinkDialog(true)}
            className={`p-1 rounded ${editor.isActive('link') ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            <Link2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1 rounded ${editor.isActive('bulletList') ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1 rounded ${editor.isActive('orderedList') ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            <ListOrdered className="h-4 w-4" />
          </button>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* File upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            disabled={isUploading}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          
          {/* File input */}
          {createFileInput(fileInputRef, handleFileInputChange)}
        </div>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {/* Attachments display */}
      {attachments.length > 0 && (
        <div className={`p-2 border-t ${formMemoToolbarClass}`}>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            Attachments ({attachments.length}):
          </div>
          <div className="space-y-1">
            {attachments.map((file, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload error display */}
      {uploadError && (
        <div className="p-2 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
          <div className="text-sm text-red-600 dark:text-red-400">
            Upload error: {uploadError}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className={`flex items-center justify-end space-x-2 p-2 border-t ${formMemoToolbarClass}`}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isUploading}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? 'Uploading...' : (isEditing ? 'Update' : 'Comment')}
        </button>
      </div>

      {/* Link dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-medium mb-4">Add Link</h3>
            <form onSubmit={handleLinkSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  URL
                </label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className={formFieldClass(false, { widthClass: 'w-full' })}
                  placeholder="https://example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Link Text
                </label>
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  className={formFieldClass(false, { widthClass: 'w-full' })}
                  placeholder="Click here"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowLinkDialog(false)}
                  className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Add Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Bundle Tiptap for browser use
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';

// Export to window for use in JSX
window.TiptapReact = { useEditor, EditorContent };
window.TiptapExtensions = { StarterKit, Underline, TextStyle, Color, TextAlign, Link, Placeholder };
window.tiptapLoaded = true;

console.log('✅ Tiptap bundle loaded successfully');

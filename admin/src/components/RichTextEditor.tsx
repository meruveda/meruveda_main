import React, { useRef, useEffect } from 'react'
import { Bold, Italic, List, ListOrdered } from 'lucide-react'

interface RichTextEditorProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, placeholder }) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const isUpdatingRef = useRef(false)

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value && !isUpdatingRef.current) {
      editorRef.current.innerHTML = value || ''
    }
  }, [value])

  const handleInput = () => {
    if (editorRef.current) {
      isUpdatingRef.current = true
      onChange(editorRef.current.innerHTML)
      // reset the ref asynchronously after React update cycle
      setTimeout(() => {
        isUpdatingRef.current = false
      }, 0)
    }
  }

  const executeCommand = (command: string, arg: string = '') => {
    document.execCommand(command, false, arg)
    handleInput()
  }

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent transition-all">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 items-center p-2 border-b border-slate-150 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => executeCommand('bold')}
          className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          title="Bold"
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => executeCommand('italic')}
          className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          title="Italic"
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => executeCommand('insertUnorderedList')}
          className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          title="Bullet List (Pointers)"
        >
          <List size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => executeCommand('insertOrderedList')}
          className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          title="Numbered List"
        >
          <ListOrdered size={15} />
        </button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        className="p-4 min-h-[240px] outline-none text-sm leading-relaxed text-slate-800 dark:text-slate-200 rich-text-editor-content max-w-none focus:outline-none"
        style={{ minHeight: '240px' }}
        data-placeholder={placeholder}
      />
    </div>
  )
}

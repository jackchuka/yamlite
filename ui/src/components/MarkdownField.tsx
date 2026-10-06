import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { codeLanguage, highlight } from "@/lib/codeHighlight";
import { mdxError, remarkMdx, remarkMdxPreview } from "@/lib/mdx";
import { useTheme } from "@/lib/theme";
import type { FieldProps } from "./FormField";
import { m } from "@/paraglide/messages.js";

const MARKDOWN_EXTENSIONS = [markdown({ codeLanguages: codeLanguage }), EditorView.lineWrapping];
const GFM = [remarkGfm];
const MDX = [remarkMdx, remarkGfm, remarkMdxPreview];

const PREVIEW_COMPONENTS: Components = {
  // a link followed in place would leave the app and drop the record being edited
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const lang = /\blanguage-(\S+)/.exec(className ?? "")?.[1];
    const tokens = lang && typeof children === "string" ? highlight(children.replace(/\n$/, ""), lang) : null;
    if (!tokens) return <code className={className}>{children}</code>;
    return (
      <code className={className}>
        {tokens.map((t, i) =>
          t.className ? (
            <span key={i} className={t.className}>
              {t.text}
            </span>
          ) : (
            t.text
          ),
        )}
      </code>
    );
  },
  // a wide table scrolls on its own instead of widening the form
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

// edits the source as written: a rich editor would rewrite the markdown and show up as a diff in the file
export default function MarkdownField({ path, value, onChange, readOnly, mdx }: FieldProps) {
  const text = value == null ? "" : String(value);
  const theme = useTheme();
  const error = useMemo(() => (mdx ? mdxError(text) : null), [mdx, text]);
  return (
    // an empty field has nothing to preview, so it opens ready to type
    <Tabs defaultValue={text === "" ? "edit" : "preview"} className="gap-1">
      <TabsList className="h-7 max-md:h-8">
        <TabsTrigger value="preview" className="text-[12px] max-md:text-[13px]">
          {m.form_preview()}
        </TabsTrigger>
        <TabsTrigger value="edit" className="text-[12px] max-md:text-[13px]">
          {m.form_edit()}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="edit">
        <CodeMirror
          aria-label={path.join(".")}
          value={text}
          extensions={MARKDOWN_EXTENSIONS}
          theme={theme}
          editable={!readOnly}
          basicSetup={{ lineNumbers: false, foldGutter: false }}
          minHeight="6rem"
          className="overflow-hidden rounded-md border text-[13px]"
          onChange={onChange}
        />
      </TabsContent>
      <TabsContent value="preview" className="md-preview min-h-24 rounded-md border px-4 py-3">
        {error && <p className="md-error">{m.form_mdx_error({ error })}</p>}
        <Markdown remarkPlugins={mdx && !error ? MDX : GFM} components={PREVIEW_COMPONENTS}>
          {text}
        </Markdown>
      </TabsContent>
    </Tabs>
  );
}

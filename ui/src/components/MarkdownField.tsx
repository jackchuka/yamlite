import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/lib/theme";
import type { FieldProps } from "./FormField";

const MARKDOWN_EXTENSIONS = [markdown(), EditorView.lineWrapping];

// a link followed in place would leave the app and drop the record being edited
const PREVIEW_COMPONENTS: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

// edits the source as written: a rich editor would rewrite the markdown and show up as a diff in the file
export default function MarkdownField({ path, value, onChange, readOnly }: FieldProps) {
  const text = value == null ? "" : String(value);
  const theme = useTheme();
  return (
    // an empty field has nothing to preview, so it opens ready to type
    <Tabs defaultValue={text === "" ? "edit" : "preview"} className="gap-1">
      <TabsList className="h-6 max-md:h-8">
        <TabsTrigger value="preview" className="text-[11px] max-md:text-[13px]">
          Preview
        </TabsTrigger>
        <TabsTrigger value="edit" className="text-[11px] max-md:text-[13px]">
          Edit
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
          className="overflow-hidden rounded-md border text-[12px]"
          onChange={onChange}
        />
      </TabsContent>
      <TabsContent value="preview" className="md-preview min-h-24 rounded-md border px-3 py-2">
        <Markdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS}>
          {text}
        </Markdown>
      </TabsContent>
    </Tabs>
  );
}

import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FieldProps } from "./FormField";

const isDark = () => document.documentElement.dataset.theme === "dark";

const MARKDOWN_EXTENSIONS = [markdown(), EditorView.lineWrapping];

// edits the source as written: a rich editor would rewrite the markdown and show up as a diff in the file
export default function MarkdownField({ path, value, onChange, readOnly }: FieldProps) {
  const text = value == null ? "" : String(value);
  return (
    // an empty field has nothing to preview, so it opens ready to type
    <Tabs defaultValue={text === "" ? "edit" : "preview"} className="gap-1">
      <TabsList className="h-6">
        <TabsTrigger value="preview" className="text-[11px]">
          Preview
        </TabsTrigger>
        <TabsTrigger value="edit" className="text-[11px]">
          Edit
        </TabsTrigger>
      </TabsList>
      <TabsContent value="edit">
        <CodeMirror
          aria-label={path.join(".")}
          value={text}
          extensions={MARKDOWN_EXTENSIONS}
          theme={isDark() ? "dark" : "light"}
          editable={!readOnly}
          basicSetup={{ lineNumbers: false, foldGutter: false }}
          minHeight="6rem"
          className="overflow-hidden rounded-md border text-[12px]"
          onChange={onChange}
        />
      </TabsContent>
      <TabsContent value="preview" className="md-preview min-h-24 rounded-md border px-3 py-2">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </TabsContent>
    </Tabs>
  );
}

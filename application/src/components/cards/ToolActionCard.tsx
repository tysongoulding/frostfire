import { ToolCallData } from "../../store/sessionStore";
import { BashTerminalCard } from "./BashTerminalCard";
import { FileEditCard } from "./FileEditCard";
import { FileWriteCard } from "./FileWriteCard";
import { FileReadCard } from "./FileReadCard";
import { WebSearchCard } from "./WebSearchCard";
import { WebFetchCard } from "./WebFetchCard";
import { McpToolCard } from "./McpToolCard";

interface ToolActionCardProps {
  toolCall: ToolCallData;
}

export function ToolActionCard({ toolCall }: ToolActionCardProps) {
  switch (toolCall.tool) {
    case "bash":
      return <BashTerminalCard toolCall={toolCall} />;
    case "edit":
      return <FileEditCard toolCall={toolCall} />;
    case "write":
      return <FileWriteCard toolCall={toolCall} />;
    case "read":
      return <FileReadCard toolCall={toolCall} />;
    case "search":
      return <WebSearchCard toolCall={toolCall} />;
    case "fetch":
      return <WebFetchCard toolCall={toolCall} />;
    default:
      return <McpToolCard toolCall={toolCall} />;
  }
}

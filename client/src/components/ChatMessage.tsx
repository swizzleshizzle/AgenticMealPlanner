interface Props {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; applied: boolean }[];
}

export default function ChatMessage({ role, content, actions }: Props) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
        role === "user" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-900"
      }`}>
        <p className="text-sm whitespace-pre-wrap">{content}</p>
        {actions && actions.length > 0 && actions[0].type !== "none" && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            {actions.map((a, i) => (
              <span key={i} className={`text-xs ${a.applied ? "text-green-600" : "text-red-500"}`}>
                {a.applied ? "Applied" : "Failed"}: {a.type}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

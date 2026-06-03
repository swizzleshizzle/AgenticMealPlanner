import ChatPanel from "../components/ChatPanel";

export default function Chat() {
  return (
    <div className="flex flex-col max-w-[780px] h-[calc(100vh-160px)] lg:h-[calc(100vh-72px)]">
      <ChatPanel />
    </div>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { GraphNode } from "@/types/memory-graph";
import SidePanel from "@/components/memory/SidePanel";
const MemoryGraph = dynamic(() => import("@/components/memory/MemoryGraph"), { ssr: false });
import type { MemoryGraphHandle } from "@/components/memory/MemoryGraph";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, MoreVertical, BadgeCheck, Search, ChevronLeft, ChevronRight, ArrowLeftCircle, ArrowRightCircle, Crosshair } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type TabKey = "rules" | "memory";

export default function PersonalizePage() {
  const tabOrder: TabKey[] = ["rules", "memory"];
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const [direction, setDirection] = useState<1 | -1>(1);
  type Prompt = {
    id: string;
    name: string;
    content: string;
    selected?: boolean;
  };
  const [userPrompts, setUserPrompts] = useState<Prompt[]>([]);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState<boolean>(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  // Removed Context tab and related state (MVP simplification)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphLinks, setGraphLinks] = useState<any[]>([]);
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(false);
  const memoryGraphRef = useRef<MemoryGraphHandle | null>(null);
  const [nodeOrder, setNodeOrder] = useState<string[]>([]);
  const [nodeIndex, setNodeIndex] = useState<number>(0);
  // Removed uploads and storage widget (part of Context feature)

  const presetPrompts = [
    {
      name: "Blank Prompt",
      content: "",
      isBlank: true,
    },
    {
      name: "School",
      content:
        "You are a school and lecture assistant. Your goal is to help the user, a student, understand academic material and answer questions.\n\nWhenever a question appears on the user's screen or task cloud, provide a direct, step-by-step answer, showing all mathematical reasoning or calculations.\n\nIf the user is watching a lecture or similar academic material, jot concepts and clarify definitions as they come up.",
    },
    {
      name: "Meetings",
      content:
        "You are a meeting assistant. Your goal is to help the user advance the conversation and perform effectively in any meeting.\n\nYou also perform any user asks just happened in the meeting immediately assist the user's request, providing you need to handle an ask or when you're asked what has been accomplished. So ask for agendas, when the user isn't up to. You are refreshing your role as they ask or when you're already helping and helping them throughout.",
    },
    {
      name: "Sales",
      content:
        "You are a real-time AI sales assistant, and your goal is to help the user, a sales rep, close the sale.\n\nCompany information:\n[information about the user's company]\n\nProduct information:\n[information about the company's product and answers to common questions about the product]",
    },
    {
      name: "Recruiting",
      content:
        "You are a recruiting assistant. Your goal is to help the user hire candidates effectively.\n\nUse interview methods, conduct personalized follow-up questions that prompt deeper insights into the candidate's skills and fit for the role based on what the candidate says.\n\nIf the candidate provides information that you know for sure is inaccurate based on what the recruiter tells the user immediately, providing the correct information and, if helpful, telling them why.",
    },
    {
      name: "Customer Support",
      content:
        "You are a customer support assistant. Your goal is to help the user, a support agent, address the customer's issue most efficiently and effectively.\n\nAs problems arise, you diagnose the issue by providing the user with troubleshooting steps or collecting question to move toward a solution.\n\nIf an error or technical problem is presented, you provide step-by-step troubleshooting and reference documentation or past cases when relevant.",
    },
    {
      name: "Marketing",
      content:
        "You are a marketing assistant. Create clear, on-brand copy and transform rough notes into polished messaging.",
    },
    {
      name: "Legal",
      content:
        "You assist with legal drafting. Use precise language, avoid over-promising, and flag anything requiring attorney review.",
    },
  ];

  const [templateQuery, setTemplateQuery] = useState("");
  const filteredTemplates = presetPrompts.filter((p) => {
    if ((p as any).isBlank) return templateQuery.trim() === ""; // hide blank when searching
    return (
      p.name.toLowerCase().includes(templateQuery.toLowerCase()) ||
      p.content.toLowerCase().includes(templateQuery.toLowerCase())
    );
  });
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollCarousel = (dir: 1 | -1) => {
    const el = carouselRef.current;
    if (!el) return;
    const amount = Math.max(320, Math.round(el.clientWidth * 0.8));
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const bottomRowPrompts = [
    {
      name: "Meetings",
      content:
        "You are a meeting assistant. Your goal is to help the user advance the conversation and perform effectively in any meeting.\n\nWhen needed, you answer",
    },
    {
      name: "School",
      content:
        "You are a school and lecture assistant. Your goal is to help the user, a student, understand academic material and answer questions.",
    },
    {
      name: "User Instructions",
      content:
        "You are a school and lecture assistant. Your goal is to help the user, a student, understand academic material and answer questions.",
    },
  ];

  // Load prompts from API
  async function fetchPrompts() {
    try {
      setIsLoadingPrompts(true);
      const res = await fetch("/api/prompts", { cache: "no-store" });
      const data: any = await res.json();
      if (res.ok) {
        const list: any[] = data.prompts || [];
        setUserPrompts(
          list.map((p) => ({
            id: p.id,
            name: p.name,
            content: p.content,
            selected: !!p.is_selected,
          })),
        );
      } else {
        console.error("Failed to load prompts:", data.error);
      }
    } finally {
      setIsLoadingPrompts(false);
    }
  }

  // Removed Context API helpers
  
  // Create or update prompt via API
  async function upsertPrompt(payload: { id?: string; name: string; content: string; is_selected?: boolean }) {
    if (payload.id) {
      const res = await fetch(`/api/prompts/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: payload.name, content: payload.content, is_selected: payload.is_selected }),
      });
      return res.json();
    } else {
      const res = await fetch(`/api/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: payload.name, content: payload.content, is_selected: payload.is_selected }),
      });
      return res.json();
    }
  }

  async function deletePrompt(id: string) {
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    return res.json();
  }

  // Optimistic selection helpers
  function setSelectionLocal(promptId: string, makeSelected: boolean) {
    setUserPrompts((prev) => {
      if (makeSelected) {
        return prev.map((it) => ({ ...it, selected: it.id === promptId }));
      }
      return prev.map((it) => (it.id === promptId ? { ...it, selected: false } : it));
    });
  }

  async function persistSelection(
    prompt: Prompt,
    makeSelected: boolean,
  ) {
    try {
      await upsertPrompt({
        id: prompt.id,
        name: prompt.name,
        content: prompt.content,
        is_selected: makeSelected,
      });
    } catch (e) {
      console.error("Failed to persist selection, refetching", e);
      await fetchPrompts();
    }
  }

  const handleTabChange = (next: TabKey) => {
    const nextIndex = tabOrder.indexOf(next);
    const currentIndex = tabOrder.indexOf(activeTab);
    setDirection(nextIndex > currentIndex ? 1 : -1);
    setActiveTab(next);
  };

  useEffect(() => {
    fetchPrompts();
  }, []);


  const slideVariants = {
    enter: (dir: number) => ({ x: `${dir * 100}%`, opacity: 1 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: `${-dir * 100}%`, opacity: 1 }),
  } as const;

  return (
    <div className="flex flex-col h-screen bg-white relative">
      {/* Top Bar (matches Connections page style) */}
      <div className="px-8 pt-10 pb-0 bg-white border-b border-gray-200">
        <div className="mb-2 pl-2">
          <h1
            className="text-2xl font-normal text-gray-900"
            style={{ fontFamily: "var(--font-merriweather), serif" }}
          >
            Personalize
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Add/manage custom rules and memory for your agent
          </p>
        </div>
        {/* Tabs in top nav area */}
        <div className="mt-8 pl-2">
          <div
            role="tablist"
            aria-label="Personalize tabs"
            className="-mb-px flex gap-6"
          >
            <button
              role="tab"
              id="tab-rules"
              aria-controls="panel-rules"
              aria-selected={activeTab === "rules"}
              onClick={() => handleTabChange("rules")}
              className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                activeTab === "rules"
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Persona
            </button>
            <button
              role="tab"
              id="tab-memory"
              aria-controls="panel-memory"
              aria-selected={activeTab === "memory"}
              onClick={() => handleTabChange("memory")}
              className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                activeTab === "memory"
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Memory
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 w-full">
          {/* Panels with slide animation (scrollable rules section) */}
          <div className="pl-2 pt-6 relative min-h-[520px] overflow-x-hidden overflow-y-auto h-[calc(100vh-160px)] hide-scrollbar">
            <AnimatePresence mode="sync" custom={direction}>
              <motion.div
                key={activeTab}
                role="tabpanel"
                aria-labelledby={`tab-${activeTab}`}
                id={`panel-${activeTab}`}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  type: "tween",
                  ease: [0.33, 1, 0.68, 1],
                  duration: 0.32,
                }}
                className="focus:outline-none absolute inset-0"
                style={{ willChange: "transform" }}
              >
                {activeTab === "rules" && (
                  <div className="pr-4">
                    {/* Your prompts first */}
                    <div className={`${userPrompts.length === 0 ? "mt-10 mb-6" : "mt-1 mb-0"}`}>
                      <h2 className="text-sm font-medium text-gray-800">Your prompts</h2>
                      <p className="text-xs text-gray-500 mb-5">Manage and switch your saved prompts.</p>
                      {userPrompts.length === 0 ? (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-6 mb-4 h-40 flex items-center justify-center text-center"
                        >
                          <p className="text-sm text-gray-500">No prompts yet. Create one from a template or the blank card below.</p>
                        </motion.div>
                      ) : (
                        <div className="mt-2 pt-2 hide-scrollbar overflow-y-auto pr-1 h-[48vh]">
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8 pr-2">
                          {userPrompts.map((p) => (
                            <div key={p.id} className="flex flex-col items-start">
                              <motion.div
                                onClick={() => {
                                  const makeSelected = !p.selected;
                                  setSelectionLocal(p.id, makeSelected);
                                  persistSelection(p, makeSelected);
                                }}
                                className={`relative border rounded bg-white p-3 h-64 cursor-pointer transition-shadow hover:shadow-sm flex items-center w-full max-w-[200px] sm:max-w-[220px] ${
                                  p.selected ? "border-green-500 ring-1 ring-green-100" : "border-gray-200"
                                }`}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                whileHover={{ y: -2 }}
                                transition={{ type: "tween", duration: 0.18 }}
                              >
                                <p className="text-[10px] sm:text-[11px] text-gray-500 leading-snug line-clamp-10 text-left">
                                  {p.content}
                                </p>
                                <AnimatePresence>
                                  {p.selected && (
                                    <motion.div
                                      className="absolute top-2 left-2"
                                      initial={{ scale: 0.6, opacity: 0 }}
                                      animate={{ scale: 1, opacity: 1 }}
                                      exit={{ scale: 0.6, opacity: 0 }}
                                    >
                                      <BadgeCheck className="w-5 h-5 text-green-600" />
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                                <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button className="p-1 rounded hover:bg-gray-100 text-gray-600" aria-label="Prompt actions">
                                        <MoreVertical className="w-4 h-4" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          await upsertPrompt({ id: p.id, name: p.name, content: p.content, is_selected: !p.selected });
                                          await fetchPrompts();
                                        }}
                                      >
                                        {p.selected ? "Unselect" : "Select"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => {
                                        setModalMode("edit");
                                        setEditingPromptId(p.id);
                                        setFormName(p.name);
                                        setFormContent(p.content);
                                        setShowModal(true);
                                      }}>Edit</DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600" onClick={async () => {
                                        await deletePrompt(p.id);
                                        await fetchPrompts();
                                      }}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </motion.div>
                              <div className="mt-3 text-sm font-medium text-gray-900 truncate max-w-[200px] sm:max-w-[220px]">{p.name}</div>
                            </div>
                          ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Templates section below with search and carousel */}
                    <div className={`${userPrompts.length === 0 ? "mt-10" : "mt-0"} pb-16`}>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <h2 className="text-sm font-medium text-gray-800">Templates</h2>
                          <p className="text-xs text-gray-500">Start from a preset or create your own.</p>
                        </div>
                        <div className="relative w-full max-w-sm">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={templateQuery}
                            onChange={(e) => setTemplateQuery(e.target.value)}
                            placeholder="Search templates..."
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:ring-0 focus:ring-offset-0 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="relative mt-0 pl-3 pr-2 pt-2 h-72">
                        <div
                          ref={carouselRef}
                          className="hide-scrollbar flex items-stretch gap-5 overflow-x-auto overflow-y-visible pt-2 pb-2 pr-2 snap-x snap-mandatory"
                        >
                          {/* Add your own card first (no dotted border) */}
                          <div className="flex-none w-48 snap-start">
                            <motion.button
                              onClick={() => {
                                setModalMode("create");
                                setEditingPromptId(null);
                                setFormName("");
                                setFormContent("");
                                setShowModal(true);
                              }}
                              className="w-full h-64 border border-gray-200 rounded bg-white hover:shadow-sm transition-shadow flex items-center justify-center"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              whileTap={{ scale: 0.98 }}
                            >
                              <Plus className="w-12 h-12 text-gray-500" strokeWidth={1} />
                            </motion.button>
                            <div className="mt-3 text-xs font-medium text-gray-800 line-clamp-1">Blank prompt</div>
                          </div>

                          <AnimatePresence mode="popLayout">
                          {filteredTemplates
                            .filter((t) => !(t as any).isBlank)
                            .map((t, idx) => (
                              <div key={idx} className="flex-none w-48 snap-start">
                                <motion.button
                                  onClick={() => {
                                    setModalMode("create");
                                    setEditingPromptId(null);
                                    setFormName(t.name);
                                    setFormContent(t.content);
                                    setShowModal(true);
                                  }}
                                  className="w-full h-64 border border-gray-200 rounded bg-white hover:shadow-sm transition-shadow text-left p-3 flex items-start pt-3"
                                  layout
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                whileHover={{ scale: 1.01 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  <p className="text-[10px] sm:text-[11px] text-gray-400 leading-snug line-clamp-10 font-mono">
                                    {t.content}
                                  </p>
                                </motion.button>
                                <div className="mt-3 text-xs font-medium text-gray-800 line-clamp-1">{t.name}</div>
                              </div>
                            ))}
                          </AnimatePresence>
                        </div>

                        {/* Carousel controls */}
                        <div className="absolute inset-0 pointer-events-none">
                          <button
                            type="button"
                            onClick={() => scrollCarousel(-1)}
                            className="pointer-events-auto absolute top-1/2 -translate-y-1/2 left-0 h-8 w-8 rounded-full border border-gray-200 bg-white/90 shadow-sm hover:bg-white flex items-center justify-center"
                            aria-label="Scroll left"
                          >
                            <ChevronLeft className="w-4 h-4 text-gray-700" />
                          </button>
                          <button
                            type="button"
                            onClick={() => scrollCarousel(1)}
                            className="pointer-events-auto absolute top-1/2 -translate-y-1/2 right-2 h-8 w-8 rounded-full border border-gray-200 bg-white/90 shadow-sm hover:bg-white flex items-center justify-center"
                            aria-label="Scroll right"
                          >
                            <ChevronRight className="w-4 h-4 text-gray-700" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Modal moved outside sliding container */}
                  </div>
                )}
                
                {activeTab === "memory" && (
                  <div className="pr-0 h-full">
                    <div className={`relative h-[64vh] w-full rounded border border-gray-200 overflow-hidden`}>
                      <div className={`${panelCollapsed ? 'absolute inset-0' : 'absolute inset-y-0 left-0 right-96'} transition-all duration-300 ease-out`}>
                        {/* Graph viewport controls */}
                        <div className="absolute left-3 top-3 z-10 flex gap-2">
                          <button
                            type="button"
                            onClick={() => memoryGraphRef.current?.recenterView()}
                            className="h-10 w-10 rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 transition shadow-none flex items-center justify-center"
                            aria-label="Recenter graph"
                          >
                            <Crosshair className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (nodeOrder.length === 0) return;
                              const next = (nodeIndex - 1 + nodeOrder.length) % nodeOrder.length;
                              setNodeIndex(next);
                              const id = nodeOrder[next];
                              memoryGraphRef.current?.focusNode(id);
                              setPanelCollapsed(false);
                            }}
                            className="h-10 w-10 rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 transition shadow-none flex items-center justify-center"
                            aria-label="Previous node"
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (nodeOrder.length === 0) return;
                              const next = (nodeIndex + 1) % nodeOrder.length;
                              setNodeIndex(next);
                              const id = nodeOrder[next];
                              memoryGraphRef.current?.focusNode(id);
                              setPanelCollapsed(false);
                            }}
                            className="h-10 w-10 rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 transition shadow-none flex items-center justify-center"
                            aria-label="Next node"
                          >
                            <ChevronRight className="w-5 h-5" />
                          </button>
                        </div>

                        <MemoryGraph
                          ref={memoryGraphRef as any}
                          onSelectNode={(n) => { setSelectedNode(n); if (n) setPanelCollapsed(false); }}
                          onGraphUpdate={(nodes, links) => {
                            setGraphLinks(links as any);
                            const ids = (nodes || []).map((n) => n.id);
                            setNodeOrder(ids);
                            if (selectedNode) {
                              const idx = ids.indexOf(selectedNode.id);
                              if (idx >= 0) setNodeIndex(idx);
                            }
                          }}
                        />
                      </div>
                      <SidePanel
                        node={selectedNode}
                        links={graphLinks as any}
                        onCloseAction={() => setSelectedNode(null)}
                        onExpandAction={(id) => memoryGraphRef.current?.expandNode(id)}
                        collapsed={panelCollapsed}
                        setCollapsed={setPanelCollapsed}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      {/* Global modal overlay (outside panels) */}
      <AnimatePresence>
      {showModal && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => setShowModal(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="fixed z-50 left-1/2 top-24 -translate-x-1/2 w-full max-w-xl"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "tween", duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
          >
            <div className="rounded border border-gray-200 bg-white shadow-lg">
              <div className="p-4 sm:p-6">
                <h3 className="text-base font-medium text-gray-900 mb-4">
                  {modalMode === "edit" ? "Edit prompt" : "Create prompt"}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Prompt name</label>
                    <Input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g., Concise expert"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Prompt</label>
                    <Textarea
                      value={formContent}
                      onChange={(e) => setFormContent(e.target.value)}
                      placeholder="Write the instruction your agent should follow..."
                      className="min-h-[160px]"
                    />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setShowModal(false)}
                    className="text-gray-700"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      (async () => {
                        if (modalMode === "edit" && editingPromptId) {
                          await upsertPrompt({ id: editingPromptId, name: formName.trim() || "Untitled", content: formContent });
                        } else {
                          await upsertPrompt({ name: formName.trim() || "Untitled", content: formContent, is_selected: true });
                        }
                        setShowModal(false);
                        await fetchPrompts();
                      })();
                    }}
                    disabled={!formName.trim() && !formContent.trim()}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>
      {/* Removed Context modal and storage widget */}
      <style jsx>{`
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("app_prompts")
      .select("id, name, content, is_selected, updated_at")
      .eq("user_id", user.id)
      .order("is_selected", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ prompts: data ?? [] });
  } catch (error) {
    console.error("GET /api/prompts error", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

type PromptBody = { name?: string; content?: string; is_selected?: boolean };

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as unknown as PromptBody;
    const name: string = ((body && body.name) || "").toString();
    const content: string = ((body && body.content) || "").toString();
    const isSelected: boolean = !!(body && body.is_selected);

    if (!name.trim() || !content.trim()) {
      return NextResponse.json(
        { error: "Both name and content are required" },
        { status: 400 },
      );
    }

    if (isSelected) {
      await supabase
        .from("app_prompts")
        .update({ is_selected: false })
        .eq("user_id", user.id);
    }

    const { data, error } = await supabase
      .from("app_prompts")
      .insert({ user_id: user.id, name, content, is_selected: isSelected })
      .select("id, name, content, is_selected, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ prompt: data }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/prompts error", error);
    const msg = error?.message || "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

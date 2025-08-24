import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type PromptUpdateBody = { name?: string; content?: string; is_selected?: boolean };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = (await request.json()) as unknown as PromptUpdateBody;
    const name: string | undefined = body?.name;
    const content: string | undefined = body?.content;
    const isSelected: boolean | undefined = body?.is_selected;

    // If selecting, unselect others first
    if (isSelected === true) {
      await supabase.from("app_prompts").update({ is_selected: false }).eq("user_id", user.id);
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (content !== undefined) updates.content = content;
    if (isSelected !== undefined) updates.is_selected = isSelected;

    const { data, error } = await supabase
      .from("app_prompts")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, name, content, is_selected, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ prompt: data });
  } catch (error) {
    console.error("PATCH /api/prompts/[id] error", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { error } = await supabase
      .from("app_prompts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/prompts/[id] error", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

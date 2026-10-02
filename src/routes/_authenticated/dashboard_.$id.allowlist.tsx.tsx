import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createFileRoute,
  Link,
  useParams,
} from "@tanstack/react-router";

import {
  ArrowLeft,
  Loader2,
  Users,
  Upload,
  FileDown,
  ArrowRightLeft,
  Copy,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute(
  "/_authenticated/dashboard_/$id/allowlist/tsx",
)({
  head: () => ({
    meta: [
      {
        title:
          "Quản lý Allow-list — Joinly",
      },
    ],
  }),

  component: AllowlistPage,
});

type EventRow = {
  id: string;
  name: string;

  allowlist_enabled: boolean;

  allowlist_scope:
    | "event"
    | "room";
};

type Room = {
  id: string;
  name: string;
};

type AllowlistEntry = {
  id: string;

  event_id: string;

  room_id: string | null;

  full_name: string | null;

  email: string | null;

  student_id: string | null;

  created_at: string;
};

function parseCsv(
  text: string,
): string[][] {
  const cleanText =
    text.replace(/^\uFEFF/, "");

  const firstLine =
    cleanText.split(/\r?\n/)[0] ??
    "";

  const commaCount =
    (
      firstLine.match(/,/g) ?? []
    ).length;

  const semicolonCount =
    (
      firstLine.match(/;/g) ??
      []
    ).length;

  const delimiter =
    semicolonCount > commaCount
      ? ";"
      : ",";

  const rows: string[][] = [];

  let row: string[] = [];

  let cell = "";

  let insideQuotes = false;

  for (
    let i = 0;
    i < cleanText.length;
    i++
  ) {
    const char = cleanText[i];

    const next =
      cleanText[i + 1];

    if (char === '"') {
      if (
        insideQuotes &&
        next === '"'
      ) {
        cell += '"';

        i++;
      } else {
        insideQuotes =
          !insideQuotes;
      }

      continue;
    }

    if (
      char === delimiter &&
      !insideQuotes
    ) {
      row.push(cell.trim());

      cell = "";

      continue;
    }

    if (
      (char === "\n" ||
        char === "\r") &&
      !insideQuotes
    ) {
      if (
        char === "\r" &&
        next === "\n"
      ) {
        i++;
      }

      row.push(cell.trim());

      if (
        row.some(
          (value) =>
            value !== "",
        )
      ) {
        rows.push(row);
      }

      row = [];

      cell = "";

      continue;
    }

    cell += char;
  }

  row.push(cell.trim());

  if (
    row.some(
      (value) => value !== "",
    )
  ) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(
  value: string,
) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .replace(/\s+/g, "_");
}

function AllowlistPage() {
  const { id } = useParams({
    from: "/_authenticated/dashboard_/$id/allowlist/tsx",
  });

  const [event, setEvent] =
    useState<EventRow | null>(
      null,
    );

  const [rooms, setRooms] =
    useState<Room[]>([]);

  const [
    allowlist,
    setAllowlist,
  ] = useState<
    AllowlistEntry[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [search, setSearch] =
    useState("");

  // Mặc định xem toàn sự kiện
  const [
    selectedRoomId,
    setSelectedRoomId,
  ] =
    useState<string>(
      "event",
    );

  const [
    importing,
    setImporting,
  ] = useState(false);

  const csvInputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const [
    selectedIds,
    setSelectedIds,
  ] = useState<string[]>([]);

  const [
    targetRoomId,
    setTargetRoomId,
  ] = useState<string>("");

  const [
    processing,
    setProcessing,
  ] = useState(false);

  const load =
    useCallback(async () => {
      setLoading(true);

      const [
        {
          data: eventData,
          error: eventError,
        },

        {
          data: roomData,
          error: roomError,
        },

        {
          data: allowlistData,
          error: allowlistError,
        },
      ] = await Promise.all([
        supabase
          .from("events")
          .select(
            "id, name, allowlist_enabled, allowlist_scope",
          )
          .eq("id", id)
          .maybeSingle(),

        supabase
          .from("event_rooms")
          .select("id, name")
          .eq("event_id", id)
          .order("position"),

        supabase
          .from("event_allowlist")
          .select(
            "id, event_id, room_id, full_name, email, student_id, created_at",
          )
          .eq("event_id", id)
          .order("created_at", {
            ascending: false,
          }),
      ]);

      if (eventError) {
        console.error(
          "Load event:",
          eventError,
        );
      }

      if (roomError) {
        console.error(
          "Load rooms:",
          roomError,
        );
      }

      if (allowlistError) {
        console.error(
          "Load allowlist:",
          allowlistError,
        );
      }

      setEvent(
        eventData as EventRow | null,
      );

      setRooms(
        (roomData as Room[]) ??
          [],
      );

      setAllowlist(
        (allowlistData as AllowlistEntry[]) ??
          [],
      );

      setLoading(false);
    }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadCsvTemplate =
    () => {
      const csv =
        "\uFEFFfull_name,email,student_id\n" +
        "Nguyễn Văn A,nguyenvana@example.com,SE190001\n" +
        "Trần Văn B,tranvanb@example.com,SE190002\n";

      const blob = new Blob(
        [csv],
        {
          type: "text/csv;charset=utf-8",
        },
      );

      const url =
        URL.createObjectURL(
          blob,
        );

      const a =
        document.createElement(
          "a",
        );

      a.href = url;

      a.download =
        "joinly-allowlist-template.csv";

      a.click();

      URL.revokeObjectURL(url);
    };

  const importCsv = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file =
      e.target.files?.[0];

    e.target.value = "";

    if (!file) return;

    const targetRoomId =
      selectedRoomId === "event"
        ? null
        : selectedRoomId;

    setImporting(true);

    try {
      const text =
        await file.text();

      const rows =
        parseCsv(text);

      if (rows.length < 2) {
        toast.error(
          "File CSV không có dữ liệu.",
        );

        return;
      }

      const headers =
        rows[0].map(
          normalizeHeader,
        );

      const fullNameIndex =
        headers.findIndex(
          (header) =>
            [
              "full_name",
              "name",
              "ho_ten",
              "hoten",
            ].includes(
              header,
            ),
        );

      const emailIndex =
        headers.findIndex(
          (header) =>
            header === "email",
        );

      const studentIdIndex =
        headers.findIndex(
          (header) =>
            [
              "student_id",
              "studentid",
              "mssv",
              "ma_sinh_vien",
            ].includes(
              header,
            ),
        );

      if (
        emailIndex === -1 &&
        studentIdIndex === -1
      ) {
        toast.error(
          "CSV phải có ít nhất cột Email hoặc MSSV.",
        );

        return;
      }

      // =========================
      // Lấy dữ liệu đã tồn tại
      // trong phạm vi đang import
      // =========================

      let existingQuery =
        supabase
          .from(
            "event_allowlist",
          )
          .select(
            "email, student_id",
          )
          .eq(
            "event_id",
            id,
          );

      if (
        targetRoomId === null
      ) {
        existingQuery =
          existingQuery.is(
            "room_id",
            null,
          );
      } else {
        existingQuery =
          existingQuery.eq(
            "room_id",
            targetRoomId,
          );
      }

      const {
        data: existingEntries,
        error: existingError,
      } =
        await existingQuery;

      if (existingError) {
        throw existingError;
      }

      const usedEmails =
        new Set<string>();

      const usedStudentIds =
        new Set<string>();

      for (
        const item of
          existingEntries ?? []
      ) {
        if (item.email) {
          usedEmails.add(
            item.email
              .trim()
              .toLowerCase(),
          );
        }

        if (
          item.student_id
        ) {
          usedStudentIds.add(
            item.student_id
              .trim()
              .toUpperCase(),
          );
        }
      }

      const newRows: {
        event_id: string;

        room_id:
          | string
          | null;

        full_name:
          | string
          | null;

        email:
          | string
          | null;

        student_id:
          | string
          | null;
      }[] = [];

      let skipped = 0;

      // =========================
      // Đọc từng dòng
      // =========================

      for (
        const row of
          rows.slice(1)
      ) {
        const fullName =
          fullNameIndex >= 0
            ? row[
                fullNameIndex
              ]?.trim() ||
              null
            : null;

        const email =
          emailIndex >= 0
            ? row[
                emailIndex
              ]
                ?.trim()
                .toLowerCase() ||
              null
            : null;

        const studentId =
          studentIdIndex >= 0
            ? row[
                studentIdIndex
              ]
                ?.trim()
                .toUpperCase() ||
              null
            : null;

        if (
          !email &&
          !studentId
        ) {
          skipped++;

          continue;
        }

        if (
          email &&
          usedEmails.has(
            email,
          )
        ) {
          skipped++;

          continue;
        }

        if (
          studentId &&
          usedStudentIds.has(
            studentId,
          )
        ) {
          skipped++;

          continue;
        }

        newRows.push({
          event_id: id,

          room_id:
            targetRoomId,

          full_name:
            fullName,

          email,

          student_id:
            studentId,
        });

        if (email) {
          usedEmails.add(
            email,
          );
        }

        if (studentId) {
          usedStudentIds.add(
            studentId,
          );
        }
      }

      if (
        newRows.length === 0
      ) {
        toast.info(
          "Những người trong file này đã có trong Allow-list.",
        );

        return;
      }

      // =========================
      // Insert
      // =========================

      const {
        data: insertedRows,
        error: insertError,
      } =
        await supabase
          .from(
            "event_allowlist",
          )
          .insert(
            newRows,
          )
          .select(
            "id, event_id, room_id, full_name, email, student_id, created_at",
          );

      if (insertError) {
        console.error(
          "Import Allow-list error:",
          insertError,
        );

        toast.error(
          "Không thể import danh sách. Vui lòng kiểm tra lại file CSV.",
        );

        return;
      }

      setAllowlist(
        (current) => [
          ...(
            insertedRows ??
            []
          ),
          ...current,
        ],
      );

      if (skipped > 0) {
        toast.success(
          `Đã thêm ${
            insertedRows?.length ??
            0
          } người. Bỏ qua ${skipped} dòng trùng hoặc không hợp lệ.`,
        );
      } else {
        toast.success(
          `Đã thêm ${
            insertedRows?.length ??
            0
          } người vào Allow-list.`,
        );
      }
    } catch (error) {
      console.error(
        "Import CSV:",
        error,
      );

      toast.error(
        "Không thể import danh sách. Vui lòng kiểm tra lại file.",
      );
    } finally {
      setImporting(false);
    }
  };

  // =========================
  // Lọc Allow-list
  // =========================
  //
  // Toàn sự kiện:
  // lấy tất cả người,
  // kể cả người nằm trong từng phòng.
  //
  // Phòng cụ thể:
  // lấy người chung toàn sự kiện
  // + người thuộc đúng phòng.
  // =========================

  const filteredAllowlist =
    allowlist.filter(
      (person) => {
        const matchRoom =
          selectedRoomId ===
          "event"
            ? true
            : person.room_id ===
                null ||
              person.room_id ===
                selectedRoomId;

        if (!matchRoom) {
          return false;
        }

        const keyword =
          search
            .trim()
            .toLowerCase();

        if (!keyword) {
          return true;
        }

        return (
          person.full_name
            ?.toLowerCase()
            .includes(
              keyword,
            ) ||
          person.email
            ?.toLowerCase()
            .includes(
              keyword,
            ) ||
          person.student_id
            ?.toLowerCase()
            .includes(
              keyword,
            )
        );
      },
    );

  const selectedPeople =
    allowlist.filter(
      (person) =>
        selectedIds.includes(
          person.id,
        ),
    );

  const currentRoomSelected =
    selectedRoomId !==
    "event";

  const selectableIds =
    filteredAllowlist.map(
      (person) =>
        person.id,
    );

  const allVisibleSelected =
    selectableIds.length > 0 &&
    selectableIds.every(
      (entryId) =>
        selectedIds.includes(
          entryId,
        ),
    );

  const togglePerson = (
    personId: string,
  ) => {
    setSelectedIds(
      (current) =>
        current.includes(
          personId,
        )
          ? current.filter(
              (id) =>
                id !==
                personId,
            )
          : [
              ...current,
              personId,
            ],
    );
  };

  const toggleSelectAllVisible =
    () => {
      if (
        allVisibleSelected
      ) {
        setSelectedIds(
          (current) =>
            current.filter(
              (id) =>
                !selectableIds.includes(
                  id,
                ),
            ),
        );

        return;
      }

      setSelectedIds(
        (current) => [
          ...new Set([
            ...current,
            ...selectableIds,
          ]),
        ],
      );
    };

  const clearSelection =
    () => {
      setSelectedIds([]);

      setTargetRoomId("");
    };

  const copySelectedToRoom =
    async () => {
      if (
        !currentRoomSelected
      ) {
        toast.error(
          "Hãy chọn một phòng cụ thể trước khi copy.",
        );

        return;
      }

      if (
        selectedPeople.length ===
        0
      ) {
        toast.error(
          "Hãy chọn ít nhất một người.",
        );

        return;
      }

      if (!targetRoomId) {
        toast.error(
          "Hãy chọn phòng đích.",
        );

        return;
      }

      if (
        targetRoomId ===
        selectedRoomId
      ) {
        toast.error(
          "Phòng đích phải khác phòng hiện tại.",
        );

        return;
      }

      setProcessing(true);

      try {
        const {
          data: existingTarget,
          error:
            existingError,
        } =
          await supabase
            .from(
              "event_allowlist",
            )
            .select(
              "email, student_id",
            )
            .eq(
              "event_id",
              id,
            )
            .eq(
              "room_id",
              targetRoomId,
            );

        if (
          existingError
        ) {
          throw existingError;
        }

        const targetEmails =
          new Set(
            (
              existingTarget ??
              []
            )
              .map(
                (item) =>
                  item.email?.toLowerCase(),
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(
                    value,
                  ),
              ),
          );

        const targetStudentIds =
          new Set(
            (
              existingTarget ??
              []
            )
              .map(
                (item) =>
                  item.student_id?.toUpperCase(),
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(
                    value,
                  ),
              ),
          );

        const rowsToCopy =
          selectedPeople
            .filter(
              (person) => {
                if (
                  person.email &&
                  targetEmails.has(
                    person.email.toLowerCase(),
                  )
                ) {
                  return false;
                }

                if (
                  person.student_id &&
                  targetStudentIds.has(
                    person.student_id.toUpperCase(),
                  )
                ) {
                  return false;
                }

                return true;
              },
            )
            .map(
              (person) => ({
                event_id: id,

                room_id:
                  targetRoomId,

                full_name:
                  person.full_name,

                email:
                  person.email,

                student_id:
                  person.student_id,
              }),
            );

        const skipped =
          selectedPeople.length -
          rowsToCopy.length;

        if (
          rowsToCopy.length ===
          0
        ) {
          toast.info(
            "Những người đã chọn đều đã có trong phòng đích.",
          );

          return;
        }

        const {
          data: inserted,
          error,
        } =
          await supabase
            .from(
              "event_allowlist",
            )
            .insert(
              rowsToCopy,
            )
            .select(
              "id, event_id, room_id, full_name, email, student_id, created_at",
            );

        if (error) {
          throw error;
        }

        setAllowlist(
          (current) => [
            ...(
              inserted ??
              []
            ),
            ...current,
          ],
        );

        clearSelection();

        if (skipped > 0) {
          toast.success(
            `Đã copy ${
              inserted?.length ??
              0
            } người. Bỏ qua ${skipped} người đã có ở phòng đích.`,
          );
        } else {
          toast.success(
            `Đã copy ${
              inserted?.length ??
              0
            } người sang phòng mới.`,
          );
        }
      } catch (error) {
        console.error(
          "Copy Allow-list:",
          error,
        );

        toast.error(
          "Không thể copy người sang phòng khác.",
        );
      } finally {
        setProcessing(false);
      }
    };

  const moveSelectedToRoom =
    async () => {
      if (
        !currentRoomSelected
      ) {
        toast.error(
          "Hãy chọn một phòng cụ thể trước khi chuyển.",
        );

        return;
      }

      if (
        selectedPeople.length ===
        0
      ) {
        toast.error(
          "Hãy chọn ít nhất một người.",
        );

        return;
      }

      if (!targetRoomId) {
        toast.error(
          "Hãy chọn phòng đích.",
        );

        return;
      }

      if (
        targetRoomId ===
        selectedRoomId
      ) {
        toast.error(
          "Phòng đích phải khác phòng hiện tại.",
        );

        return;
      }

      setProcessing(true);

      try {
        const {
          data: existingTarget,
          error:
            existingError,
        } =
          await supabase
            .from(
              "event_allowlist",
            )
            .select(
              "email, student_id",
            )
            .eq(
              "event_id",
              id,
            )
            .eq(
              "room_id",
              targetRoomId,
            );

        if (
          existingError
        ) {
          throw existingError;
        }

        const targetEmails =
          new Set(
            (
              existingTarget ??
              []
            )
              .map(
                (item) =>
                  item.email?.toLowerCase(),
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(
                    value,
                  ),
              ),
          );

        const targetStudentIds =
          new Set(
            (
              existingTarget ??
              []
            )
              .map(
                (item) =>
                  item.student_id?.toUpperCase(),
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(
                    value,
                  ),
              ),
          );

        const alreadyInTarget =
          selectedPeople.filter(
            (person) =>
              (person.email &&
                targetEmails.has(
                  person.email.toLowerCase(),
                )) ||
              (person.student_id &&
                targetStudentIds.has(
                  person.student_id.toUpperCase(),
                )),
          );

        const needMove =
          selectedPeople.filter(
            (person) =>
              !alreadyInTarget.some(
                (
                  existing,
                ) =>
                  existing.id ===
                  person.id,
              ),
          );

        // Người chưa có ở phòng đích
        // thì đổi room_id
        if (
          needMove.length > 0
        ) {
          const idsToMove =
            needMove.map(
              (person) =>
                person.id,
            );

          const {
            error:
              moveError,
          } =
            await supabase
              .from(
                "event_allowlist",
              )
              .update({
                room_id:
                  targetRoomId,
              })
              .in(
                "id",
                idsToMove,
              );

          if (moveError) {
            throw moveError;
          }
        }

        // Nếu người đó đã có
        // ở phòng đích
        // thì xóa bản ghi nguồn
        if (
          alreadyInTarget.length >
          0
        ) {
          const duplicateSourceIds =
            alreadyInTarget.map(
              (person) =>
                person.id,
            );

          const {
            error:
              deleteError,
          } =
            await supabase
              .from(
                "event_allowlist",
              )
              .delete()
              .in(
                "id",
                duplicateSourceIds,
              );

          if (
            deleteError
          ) {
            throw deleteError;
          }
        }

        await load();

        clearSelection();

        toast.success(
          `Đã chuyển ${selectedPeople.length} người sang phòng mới.`,
        );
      } catch (error) {
        console.error(
          "Move Allow-list:",
          error,
        );

        toast.error(
          "Không thể chuyển người sang phòng khác.",
        );
      } finally {
        setProcessing(false);
      }
    };

  const deleteSelected =
    async () => {
      if (
        selectedPeople.length ===
        0
      ) {
        toast.error(
          "Hãy chọn ít nhất một người.",
        );

        return;
      }

      const confirmed =
        window.confirm(
          `Bạn có chắc muốn xóa ${selectedPeople.length} người khỏi Allow-list không?`,
        );

      if (!confirmed) {
        return;
      }

      setProcessing(true);

      try {
        const idsToDelete =
          selectedPeople.map(
            (person) =>
              person.id,
          );

        const { error } =
          await supabase
            .from(
              "event_allowlist",
            )
            .delete()
            .in(
              "id",
              idsToDelete,
            );

        if (error) {
          throw error;
        }

        setAllowlist(
          (current) =>
            current.filter(
              (person) =>
                !idsToDelete.includes(
                  person.id,
                ),
            ),
        );

        clearSelection();

        toast.success(
          `Đã xóa ${idsToDelete.length} người khỏi Allow-list.`,
        );
      } catch (error) {
        console.error(
          "Delete Allow-list:",
          error,
        );

        toast.error(
          "Không thể xóa người khỏi Allow-list.",
        );
      } finally {
        setProcessing(false);
      }
    };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Không tìm thấy sự kiện.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <Link
          to="/manage-event/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />

          Quay lại sự kiện
        </Link>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">
              Quản lý Allow-list
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              {event.name}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />

              <span className="font-medium">
                {allowlist.length} người
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card">
          {/* Thanh công cụ */}
          <div className="border-b border-border p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-display text-xl font-semibold">
                  Danh sách được phép tham gia
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  {allowlist.length} người trong Allow-list
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={importCsv}
                />

                <Button
                  variant="outline"
                  disabled={importing}
                  onClick={() =>
                    csvInputRef.current?.click()
                  }
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}

                  Import CSV
                </Button>

                <Button
                  variant="outline"
                  onClick={
                    downloadCsvTemplate
                  }
                >
                  <FileDown className="h-4 w-4" />

                  Tải CSV mẫu
                </Button>

                <Button>
                  + Thêm người
                </Button>
              </div>
            </div>

            {/* Search + chọn phòng */}
            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_260px]">
              <input
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value,
                  )
                }
                placeholder="Tìm theo họ tên, email hoặc MSSV..."
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />

              <select
                value={
                  selectedRoomId
                }
                onChange={(e) => {
                  setSelectedRoomId(
                    e.target.value,
                  );

                  setSelectedIds(
                    [],
                  );

                  setTargetRoomId(
                    "",
                  );
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="event">
                  Toàn sự kiện
                </option>

                {rooms.map(
                  (room) => (
                    <option
                      key={
                        room.id
                      }
                      value={
                        room.id
                      }
                    >
                      {
                        room.name
                      }
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          {selectedIds.length >
            0 && (
            <div className="border-b border-border bg-primary/5 px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">
                  Đã chọn{" "}
                  {
                    selectedIds.length
                  }{" "}
                  người
                </span>

                {currentRoomSelected && (
                  <>
                    <select
                      value={
                        targetRoomId
                      }
                      onChange={(
                        e,
                      ) =>
                        setTargetRoomId(
                          e
                            .target
                            .value,
                        )
                      }
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">
                        Chọn phòng đích...
                      </option>

                      {rooms
                        .filter(
                          (
                            room,
                          ) =>
                            room.id !==
                            selectedRoomId,
                        )
                        .map(
                          (
                            room,
                          ) => (
                            <option
                              key={
                                room.id
                              }
                              value={
                                room.id
                              }
                            >
                              {
                                room.name
                              }
                            </option>
                          ),
                        )}
                    </select>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        processing
                      }
                      onClick={
                        moveSelectedToRoom
                      }
                    >
                      <ArrowRightLeft className="h-4 w-4" />

                      Chuyển
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        processing
                      }
                      onClick={
                        copySelectedToRoom
                      }
                    >
                      <Copy className="h-4 w-4" />

                      Copy
                    </Button>
                  </>
                )}

                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    processing
                  }
                  onClick={
                    deleteSelected
                  }
                >
                  <Trash2 className="h-4 w-4" />

                  Xóa
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={
                    clearSelection
                  }
                >
                  Bỏ chọn
                </Button>
              </div>
            </div>
          )}

          {/* Bảng */}
          {filteredAllowlist.length ===
          0 ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              Không tìm thấy người nào trong Allow-list.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="w-12 px-5 py-3">
                      <input
                        type="checkbox"
                        checked={
                          allVisibleSelected
                        }
                        onChange={
                          toggleSelectAllVisible
                        }
                        aria-label="Chọn tất cả"
                      />
                    </th>

                    <th className="px-5 py-3 font-medium">
                      Họ tên
                    </th>

                    <th className="px-5 py-3 font-medium">
                      Email
                    </th>

                    <th className="px-5 py-3 font-medium">
                      MSSV
                    </th>

                    <th className="px-5 py-3 font-medium">
                      Phạm vi
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredAllowlist.map(
                    (
                      person,
                    ) => {
                      const room =
                        rooms.find(
                          (
                            item,
                          ) =>
                            item.id ===
                            person.room_id,
                        );

                      return (
                        <tr
                          key={
                            person.id
                          }
                          className="border-t border-border"
                        >
                          <td className="w-12 px-5 py-4">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(
                                person.id,
                              )}
                              onChange={() =>
                                togglePerson(
                                  person.id,
                                )
                              }
                              aria-label={`Chọn ${
                                person.full_name ??
                                "người tham gia"
                              }`}
                            />
                          </td>

                          <td className="px-5 py-4 font-medium">
                            {person.full_name ||
                              "—"}
                          </td>

                          <td className="px-5 py-4 text-muted-foreground">
                            {person.email ||
                              "—"}
                          </td>

                          <td className="px-5 py-4 text-muted-foreground">
                            {person.student_id ||
                              "—"}
                          </td>

                          <td className="px-5 py-4">
                            {person.room_id
                              ? room?.name ||
                                "Phòng"
                              : "Toàn sự kiện"}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
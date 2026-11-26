"use client";
import { Button, PageHeader, Panel, TextInput } from "./ui";
import { useEffect, useState } from "react";
import { SegmentedControl, Select } from "@mantine/core";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { bridge } from "@/lib/browser";
import type { BridgeConnection } from "@/lib/leetcode-bridge";
import type { LanguageId } from "@/lib/languages";
import { demoProblem } from "@/lib/demo";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ProblemCatalogProps = {
  language: LanguageId;
  onLanguageChange: (language: LanguageId) => void;
  onChoose: (slug: string) => void;
  disabled: boolean;
  connection: BridgeConnection;
  onBridgeAction: () => void;
  onRecheck: () => void;
};

export default function ProblemCatalog({
  language,
  onLanguageChange,
  onChoose,
  disabled,
  connection,
  onBridgeAction,
  onRecheck,
}: ProblemCatalogProps) {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connection.bridgeReachable && connection.kind !== "checking") {
      setLoading(false);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await bridge("list", { search, difficulty, skip, limit: 20 });
        if (live) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        if (live) setLoading(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    search,
    difficulty,
    skip,
    connection.bridgeReachable,
    connection.kind,
    connection.isSignedIn,
  ]);
  return (
    <div className="page-content">
      <PageHeader
        title="Problem library"
        actions={
          <SegmentedControl
            aria-label="Catalog language"
            size="xs"
            value={language}
            onChange={(value) => onLanguageChange(value as LanguageId)}
            data={[
              { value: "java", label: "Java 25" },
              { value: "cpp", label: "C++26" },
            ]}
          />
        }
      />
      {!connection.isSignedIn && connection.kind !== "checking" && (
        <div className="banner error library-banner">
          <span className="library-banner-text">
            <strong>{connection.label}.</strong> {connection.detail}
          </span>
          <div className="connection-actions library-banner-actions">
            <Button
              className="button primary"
              disabled={disabled}
              onClick={onBridgeAction}
            >
              {connection.actionLabel}
              {connection.externalUrl ? (
                <ArrowUpRight size={14} />
              ) : (
                <ArrowRight size={14} />
              )}
            </Button>
            {connection.externalUrl && (
              <Button
                className="button secondary"
                disabled={disabled}
                onClick={onRecheck}
              >
                Check status
              </Button>
            )}
            <Button
              className="button secondary"
              disabled={disabled}
              onClick={() => onChoose(demoProblem.titleSlug)}
            >
              Try local exercise
            </Button>
          </div>
        </div>
      )}
      <div className="library-tools">
        <TextInput
          aria-label="Search problems"
          value={search}
          placeholder="Search problems by title…"
          onChange={(e) => {
            setSearch(e.target.value);
            setSkip(0);
          }}
        />
        <Select
          aria-label="Filter difficulty"
          value={difficulty || "all"}
          allowDeselect={false}
          onChange={(value) => {
            setDifficulty(value === "all" ? "" : (value ?? ""));
            setSkip(0);
          }}
          data={[
            { value: "all", label: "All difficulties" },
            { value: "EASY", label: "Easy" },
            { value: "MEDIUM", label: "Medium" },
            { value: "HARD", label: "Hard" },
          ]}
        />
      </div>
      {error && <div className="banner error library-banner">{error}</div>}
      {!data && !loading && !connection.bridgeReachable && (
        <Panel className="panel problem-list">
          <div className="empty-state">
            <BookOpen size={20} />
            Connect the browser bridge to browse problems.
          </div>
        </Panel>
      )}
      {(data || loading) && (
        <Panel className="panel problem-list">
          <div className="table-header">
            <span>PROBLEM</span>
            <span>DIFFICULTY</span>
            <span>ACCESS</span>
          </div>
          {data?.questions?.map((p: any) => (
            <Button
              className="problem-row"
              key={p.titleSlug}
              disabled={disabled || loading}
              onClick={() => onChoose(p.titleSlug)}
            >
              <span>
                <small>
                  {p.questionFrontendId.padStart?.(3, "0") ??
                    p.questionFrontendId}
                </small>
                <strong>{p.title}</strong>
              </span>
              <span className={"difficulty " + p.difficulty.toLowerCase()}>
                {p.difficulty}
              </span>
              <span className="problem-access">
                {p.isPaidOnly ? "Premium" : "Available"}
                <ArrowUpRight size={16} />
              </span>
            </Button>
          ))}
          {loading && (
            <div className="empty-state">
              <LoaderCircle className="spin" size={20} />
              Loading problems…
            </div>
          )}
          {!loading && data?.questions?.length === 0 && (
            <div className="empty-state">
              No problems matched. Try another search.
            </div>
          )}
        </Panel>
      )}
      {data?.totalNum > 0 && (
        <div className="pagination">
          <span>
            {`${skip + 1}–${Math.min(skip + 20, data.totalNum)} of ${data.totalNum} problems`}
          </span>
          <div>
            <Button
              className="icon-button"
              aria-label="Previous page"
              disabled={skip === 0 || loading}
              onClick={() => setSkip(Math.max(0, skip - 20))}
            >
              <ChevronLeft size={17} />
            </Button>
            <Button
              className="icon-button"
              aria-label="Next page"
              disabled={!data || skip + 20 >= data.totalNum || loading}
              onClick={() => setSkip(skip + 20)}
            >
              <ChevronRight size={17} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

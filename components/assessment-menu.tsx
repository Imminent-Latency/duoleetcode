"use client";
import { ActionIcon, Menu } from "@mantine/core";
import { ArrowRight, ChevronDown, MessageSquare } from "lucide-react";

export default function AssessmentMenu({
  disabled,
  assistanceDisabled,
  onFinish,
  onAssistance,
}: {
  disabled: boolean;
  assistanceDisabled: boolean;
  onFinish: () => void;
  onAssistance: () => void;
}) {
  return (
    <Menu width={320} position="bottom-end" offset={8}>
      <Menu.Target>
        <ActionIcon
          className="submit-options"
          variant="filled"
          size="input-sm"
          aria-label="More assessment options"
          title="Finish early or record outside help"
          disabled={disabled}
        >
          <ChevronDown size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown aria-label="Assessment options">
        <Menu.Item
          leftSection={<ArrowRight size={16} />}
          disabled={disabled}
          onClick={onFinish}
        >
          <span className="assessment-options-label">
            Finish & review
            <small>End this attempt early and review your work</small>
          </span>
        </Menu.Item>
        <Menu.Item
          leftSection={<MessageSquare size={16} />}
          disabled={assistanceDisabled}
          onClick={onAssistance}
        >
          <span className="assessment-options-label">
            Record outside help
            <small>Add context about assistance you used</small>
          </span>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

<template>
  <ul class="chat-attachment-list" :class="{ 'is-editable': editable }" :aria-label="t('studioChat.attachments')">
    <li v-for="(attachment, index) in attachments" :key="index" data-testid="chat-attachment" class="chat-attachment">
      <img v-if="previews[index]" :src="previews[index]" alt="" loading="lazy" />
      <Icon v-else name="document" size="sm" />
      <span :title="attachment.name">{{ attachment.name }}</span>
      <button v-if="editable" type="button" class="studio-icon-btn chat-remove-attachment" :disabled="disabled" :aria-label="t('studioChat.removeAttachment', { name: attachment.name })" @click="emit('remove', index)">
        <Icon name="x" size="xs" />
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { studioChatAttachmentImage, type StudioChatAttachment } from '@/composables/studioChatAttachments'

const props = defineProps<{ attachments: StudioChatAttachment[]; editable?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ remove: [index: number] }>()
const { t } = useI18n()
const previews = computed(() => props.attachments.map(studioChatAttachmentImage))
</script>

<style scoped>
.chat-attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
  justify-content: flex-end;
  margin: 6px 0 0;
  padding: 0;
}
.chat-attachment-list.is-editable {
  justify-content: flex-start;
  margin: 0;
  max-height: 96px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.chat-attachment {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: min(100%, 15rem);
  padding: 4px 8px;
  border: 1px solid var(--st-border);
  border-radius: 9px;
  background: var(--st-surface);
  color: var(--st-text-soft);
  font-size: 12px;
}
.chat-attachment > img {
  width: 38px;
  height: 38px;
  border-radius: 5px;
  object-fit: cover;
}
.chat-attachment > :is(img, svg, button) { flex-shrink: 0; }
.chat-attachment > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-remove-attachment { width: 30px; height: 30px; }
</style>

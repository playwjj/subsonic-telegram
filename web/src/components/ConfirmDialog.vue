<script setup lang="ts">
import Modal from "./Modal.vue";

defineProps<{ title: string; confirmLabel: string; danger?: boolean; busy?: boolean }>();
const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <Modal :title="title" @close="emit('close')">
    <div class="space-y-2 text-sm"><slot /></div>
    <div class="mt-5 flex justify-end gap-2">
      <slot name="actions">
        <button :disabled="busy" @click="emit('close')">Cancel</button>
        <button
          class="inline-flex items-center gap-2"
          :class="danger ? 'danger' : 'primary'"
          :disabled="busy"
          autofocus
          @click="emit('confirm')"
        >
          <span v-if="busy" class="spinner"></span> {{ confirmLabel }}
        </button>
      </slot>
    </div>
  </Modal>
</template>

<style scoped>
.danger {
  border-color: var(--danger);
  color: var(--danger);
}
.primary {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

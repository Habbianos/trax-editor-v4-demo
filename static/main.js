
// Configuration and Constants
const CONFIG = {
  SLOT_WIDTH: 48,
  SLOT_HEIGHT: 48,
  SLOT_DURATION: 2000, // 2 seconds
  CHANNEL_HEADER_WIDTH: 60,
  TIMELINE_HEADER_HEIGHT: 30,
	INITIAL_CHANNEL_COUNT: 4,
  COLORS: [
	'#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', 
	'#6c5ce7', '#a29bfe', '#fd79a8', '#fdcb6e', '#55efc4'
  ],
  SYMBOLS: ['●', '■', '▲', '◆', '★', '♪', '♫', '◉', '◈']
};

// Data Model
class ModuleData {
  constructor({ id, position, ...data }) {
    this.id = id;
    this.instanceId = Date.now() + Math.random();
    this.position = position;

    Object.assign(this, data);
  }

  get end() {
    return this.position + this.length;
  }

  contains(position) {
    return position >= this.position && position < this.end;
  }

  crop(newLength) {
    if (newLength < 1 || newLength > this.originalLength) return false;
    this.length = newLength;
    return true;
  }
}

class ChannelData {
  constructor(id) {
    this.id = id;
    this.modules = [];
	  // modifiers: volume, pitch, pan
  }

  hasCollision(position, length) {
    const newEnd = position + length;
    return this.modules.some(m =>
      position < m.end && newEnd > m.position
    );
  }

  addModule(module) {
    if (this.hasCollision(module.position, module.length)) return null;

    this.modules.push(module);
    this.modules.sort((a, b) => a.position - b.position);
    return module;
  }

  removeModule(moduleId) {
    const index = this.modules.findIndex(m => m.id === moduleId);
    if (index === -1) return false;

    this.modules.splice(index, 1);
    return true;
  }

  getModuleAt(position) {
    return this.modules.find(m => m.contains(position)) ?? null;
  }

  getRightmostPosition() {
    return this.modules.reduce(
      (max, m) => Math.max(max, m.end),
      0
    );
  }
}

class TimelineData {
	static INITIAL_CHANNEL_COUNT = CONFIG?.INITIAL_CHANNEL_COUNT ?? 4

  constructor() {
    this.channels = [];
    this.nextChannelId = 0;
    this.nextModuleId = 0;

	  for (let i = 0; i < TimelineData.INITIAL_CHANNEL_COUNT; i++)
		  this.addChannel()
  }

  addChannel() {
    const channel = new ChannelData(this.nextChannelId++);
    this.channels.push(channel);
    return channel;
  }

  addModule(channelId, position, moduleData) {
    const channel = this.channels.find(c => c.id === channelId);
    if (!channel) return null;

    const module = new ModuleData({
      id: this.nextModuleId++,
      position,
      ...moduleData
    });

    return channel.addModule(module);
  }

  removeModule(channelId, moduleId) {
    const channel = this.channels.find(c => c.id === channelId);
    return channel ? channel.removeModule(moduleId) : false;
  }

  cropModule(channelId, moduleId, newLength) {
    const channel = this.channels.find(c => c.id === channelId);
    if (!channel) return false;

    const module = channel.modules.find(m => m.id === moduleId);
    return module ? module.crop(newLength) : false;
  }

  getModule(channelId, position) {
    const channel = this.channels.find(c => c.id === channelId);
    return channel ? channel.getModuleAt(position) : null;
  }

  getRightmostPosition() {
    return Math.max(
      0,
      ...this.channels.map(c => c.getRightmostPosition())
    );
  }
}

const barsToTime = b => `${String((b*=2)/60|0).padStart(2,0)}:${String(b%60).padStart(2,0)}`


// Timeline Component
class TraxTimeline extends HTMLElement {
  constructor() {
	super();
	this.data = new TimelineData();
	this.scrollX = 0;
	this.scrollY = 0;
	this.playheadPosition = 0;
	this.isPlaying = false;
	this.playInterval = null;
	  this.selectedMode = "place"
	this.selectedModule = { colorIndex: 0, symbolIndex: 0, length: 2, originalLength: 2 };
	this.isDraggingPlayhead = false;
	this.hoverInfo = null;
	this.totalSlots = 20; // Start with visible slots
  }

  connectedCallback() {
	this.innerHTML = `
	  <style>
		:host {
		  display: block;
		  position: relative;
		  background: #1a1a1a;
		  overflow: hidden;
		}

		.timeline-wrapper {
		  position: relative;
		  width: 100%;
		  height: 100%;
		  overflow: auto;
		  scroll-snap-type: both mandatory;
		  scroll-padding-top: 28px;
		  scroll-padding-left: 60px;
		}

		.timeline-content {
		  position: relative;
		  min-width: 100%;
		  width: fit-content;
		}

		.timeline-header {
		  position: sticky;
		  top: 0;
		  left: 0;
		  height: ${CONFIG.TIMELINE_HEADER_HEIGHT}px;
		  background: #2a2a2a;
		  border-bottom: 2px solid #3a3a3a;
		  z-index: 50;
		  display: flex;
		}

		.header-spacer {
		  width: ${CONFIG.CHANNEL_HEADER_WIDTH}px;
		  border-right: 2px solid #3a3a3a;
		}

		.header-slots {
		  display: flex;
		  flex: 1;
		}

		.time-slot-header {
		  width: ${CONFIG.SLOT_WIDTH}px;
		  // border-right: 1px solid #3a3a3a;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  font-size: 10px;
		  color: #888;
		}
		.time-slot-header:last-child {
		  border-right: none;
		}

		.channels-container {
		  position: relative;
		}

		.channel {
		  display: flex;
		  border-bottom: 1px solid #2a2a2a;
		}

		.channel-header {
		  position: sticky;
		  left: 0;
		  width: ${CONFIG.CHANNEL_HEADER_WIDTH}px;
		  height: ${CONFIG.SLOT_HEIGHT}px;
		  background: #2a2a2a;
		  border-right: 2px solid #3a3a3a;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  font-size: 11px;
		  color: #888;
		  z-index: 10;
		}

		.channel-slots {
		  display: flex;
		  flex: 1;
		  position: relative;
		}

		.slot {
		  width: ${CONFIG.SLOT_WIDTH}px;
		  height: ${CONFIG.SLOT_HEIGHT}px;
		  border-right: 1px solid #2a2a2a;
		  position: relative;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  scroll-snap-align: start;
		}
		.slot:last-child {
		  // border-right: none;
		}

		.slot:hover {
		  background: rgba(255,255,255,0.05);
		}

		.module-segment {
		  width: ${CONFIG.SLOT_WIDTH - 8}px;
		  height: ${CONFIG.SLOT_HEIGHT - 8}px;
		  border: 2px solid;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  font-size: 20px;
		  cursor: pointer;
		  user-select: none;
		  position: relative;
		}

		.module-segment.shadow {
		  opacity: 0.4;
		  pointer-events: none;
		}

		.module-segment.first {
		  border-top-left-radius: 15px;
		  border-bottom-left-radius: 15px;
		}

		.module-segment.last {
		  border-top-right-radius: 15px;
		  border-bottom-right-radius: 15px;
		}

		.module-segment.middle {
		  border-left: none;
		  border-right: none;
		}

		.module-connection {
		  position: absolute;
		  height: 3px;
		  top: 50%;
		  transform: translateY(-50%);
		  pointer-events: none;
		  z-index: 5;
		}

		.playhead {
		  position: absolute;
		  top: 0;
		  width: 2px;
		  background: #ff4444;
		  pointer-events: none;
		  z-index: 40;
		}

		.playhead-handle {
		  position: absolute;
		  bottom: -20px;
		  left: -8px;
		  width: 18px;
		  height: 18px;
		  background: #ff4444;
		  border: 2px solid #fff;
		  cursor: grab;
		  pointer-events: all;
		  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
		}

		.playhead-handle:active {
		  cursor: grabbing;
		}
	  </style>

	  <div class="timeline-wrapper">
		<div class="timeline-content">
		  <div class="timeline-header">
			<div class="header-spacer"></div>
			<div class="header-slots" id="header-slots"></div>
		  </div>
		  <div class="channels-container" id="channels"></div>
		  <div class="playhead" id="playhead">
			<div class="playhead-handle" id="playhead-handle"></div>
		  </div>
		</div>
	  </div>
	`;

	this.wrapper = this.querySelector('.timeline-wrapper');
	this.content = this.querySelector('.timeline-content');
	this.channelsContainer = this.querySelector('#channels');
	this.headerSlots = this.querySelector('#header-slots');
	this.playhead = this.querySelector('#playhead');
	this.playheadHandle = this.querySelector('#playhead-handle');

	this.setupEventListeners();
	this.updateTotalSlots();
	this.render();
  }

  setupEventListeners() {
	window.addEventListener('resize', () => {
	  this.updateTotalSlots()
		this.render();
	});

	// Scrolling
	this.wrapper.addEventListener('scroll', () => {
	  this.scrollX = this.wrapper.scrollLeft;
	  this.scrollY = this.wrapper.scrollTop;
	});

	// Playhead dragging
	this.playheadHandle.addEventListener('mousedown', (e) => {
	  e.preventDefault();
	  e.stopPropagation();
	  this.isDraggingPlayhead = true;
	  document.body.style.cursor = 'grabbing';
	});

	document.addEventListener('mousemove', (e) => {
	  if (this.isDraggingPlayhead) {
		const rect = this.channelsContainer.getBoundingClientRect();
		const x = e.clientX - rect.left + this.scrollX - CONFIG.CHANNEL_HEADER_WIDTH;
		const slotPosition = Math.max(0, Math.round(x / CONFIG.SLOT_WIDTH));
		this.setPlayheadPosition(slotPosition);
	  }
	});

	document.addEventListener('mouseup', () => {
	  if (this.isDraggingPlayhead) {
		this.isDraggingPlayhead = false;
		document.body.style.cursor = '';
	  }
	});

	// Module interactions
	this.channelsContainer.addEventListener('mousemove', (e) => {
	  if (this.isDraggingPlayhead) return;
	  this.handleHover(e);
	});

	this.channelsContainer.addEventListener('mouseleave', () => {
	  this.hoverInfo = null;
	  this.renderModules();
	});

	this.channelsContainer.addEventListener('click', (e) => {
	  this.handleClick(e);
	});

	this.channelsContainer.addEventListener('contextmenu', (e) => {
	  e.preventDefault();
	  this.handleRightClick(e);
	});
  }

  updateTotalSlots() {
	const viewportSlots = Math.floor((this.wrapper.clientWidth - 15) / CONFIG.SLOT_WIDTH) - 1;
	const rightmost = this.data.getRightmostPosition();
	const halfView = Math.ceil(viewportSlots / 2);
console.log(viewportSlots)
	// Ensure we have at least viewport width, and extend when modules are added
	this.totalSlots = Math.max(viewportSlots, rightmost + halfView);
  }

  handleHover(e) {
	const slot = e.target.closest('.slot');
	if (!slot) {
	  this.hoverInfo = null;
	  this.renderModules();
	  return;
	}

	const channelId = parseInt(slot.dataset.channelId);
	const position = parseInt(slot.dataset.position);

	// Check if there's already a module here
	const existingModule = this.data.getModule(channelId, position);
	if (existingModule) {
	  this.hoverInfo = null;
	  this.renderModules();
	  return;
	}

	// Check if selected module would fit
	const wouldCollide = Array.from({ length: this.selectedModule.length }, (_, i) => {
	  return this.data.getModule(channelId, position + i);
	}).some(m => m !== null);

	if (wouldCollide) {
	  this.hoverInfo = null;
	  this.renderModules();
	  return;
	}

	this.hoverInfo = { channelId, position };
	this.renderModules();
  }

  handleClick(e) {
	if (e.ctrlKey) {
	  this.handleRemove(e);
	  return;
	}

	if (e.altKey) {
	  this.handleFillClick(e);
	  return;
	}

	  if (this.selectedMode === "place")
		  this.handlePlaceClick(e)
	  else if (this.selectedMode === "remove")
		  this.handleRemove(e)
	  else if (this.selectedMode === "eyedropper")
		  this.handleRightClick(e)
	  else if (this.selectedMode === "fill")
		  this.handleFillClick(e)
  }
	
	handlePlaceClick(e) {
		
		const slot = e.target.closest('.slot');
		if (!slot) return;

		const segment = e.target.closest('.module-segment');

		if (!segment) {
		  const channelId = parseInt(slot.dataset.channelId);
		  const position = parseInt(slot.dataset.position);
		  this.placeModule(channelId, position);
		}
	}

  handleRightClick(e) {
	const segment = e.target.closest('.module-segment');
	if (segment) {
	  this.handleEyedropper(segment);
	  return;
	}
  }
  handleRemove(e) {
	const segment = e.target.closest('.module-segment');
	if (!segment) return;

	const channelId = parseInt(segment.dataset.channelId);
	const moduleId = parseInt(segment.dataset.moduleId);

	this.data.removeModule(channelId, moduleId);
	this.updateTotalSlots();
	this.render();
  }

  handleEyedropper(segmentElement) {
	const colorIndex = parseInt(segmentElement.dataset.colorIndex);
	const symbolIndex = parseInt(segmentElement.dataset.symbolIndex);
	const length = parseInt(segmentElement.dataset.originalLength);

	this.selectedModule = {
	  colorIndex,
	  symbolIndex,
	  length,
	  originalLength: length
	};

	this.dispatchEvent(new CustomEvent('module-selected', {
	  detail: this.selectedModule
	}));
  }

  handleFillClick(e) {
	const slot = e.target.closest('.slot');
	if (!slot) return;

	const channelId = parseInt(slot.dataset.channelId);
	const startPosition = parseInt(slot.dataset.position);

	// Get visible range
	const visibleStart = Math.floor(this.scrollX / CONFIG.SLOT_WIDTH);
	const visibleEnd = Math.ceil((this.scrollX + this.wrapper.clientWidth) / CONFIG.SLOT_WIDTH);

	// Find boundaries
	const channel = this.data.channels.find(c => c.id === channelId);
	if (!channel) return;

	let leftBound = visibleStart;
	let rightBound = visibleEnd;

	// Find left boundary
	for (let i = startPosition - 1; i >= visibleStart; i--) {
	  if (this.data.getModule(channelId, i)) {
		leftBound = i + 1;
		break;
	  }
	}

	// Find right boundary
	for (let i = startPosition; i < visibleEnd; i++) {
	  if (this.data.getModule(channelId, i)) {
		rightBound = i;
		break;
	  }
	}

	// Fill the area
	for (let pos = leftBound; pos < rightBound; pos += this.selectedModule.length) {
	  if (pos + this.selectedModule.length <= rightBound) {
		this.placeModule(channelId, pos);
	  }
	}
  }

  placeModule(channelId, position) {
	const added = this.data.addModule(channelId, position, { ...this.selectedModule });
	if (added) {
	  this.updateTotalSlots();
	  this.render();
	}
  }

	setSelectedMode(mode) {
		this.selectedMode = mode
	}
  setSelectedModule(module) {
	this.selectedModule = module;
  }

  addChannel() {
	this.data.addChannel();
	this.render();
  }

  play() {
	if (this.isPlaying) return;
	this.isPlaying = true;

	this.playInterval = setInterval(() => {
	  this.playheadPosition++;
	  this.updatePlayhead();
	}, CONFIG.SLOT_DURATION);
  }

  stop() {
	this.isPlaying = false;
	if (this.playInterval) {
	  clearInterval(this.playInterval);
	  this.playInterval = null;
	}
  }

  setPlayheadPosition(position) {
	this.playheadPosition = position;
	this.updatePlayhead();
  }

  updatePlayhead() {
	const x = CONFIG.CHANNEL_HEADER_WIDTH + (this.playheadPosition * CONFIG.SLOT_WIDTH);
	this.playhead.style.left = x + 'px';
	this.playhead.style.height = (this.channelsContainer.clientHeight + 30) + 'px';

	// Auto-scroll to follow playhead if needed
	if (this.isPlaying) {
	  const playheadScreenX = x - this.scrollX;
	  const viewportWidth = this.wrapper.clientWidth;

	  if (playheadScreenX > viewportWidth - 100) {
		this.wrapper.scrollLeft = x - viewportWidth / 2;
	  }
	}
  }

  render() {
	this.renderHeader();
	this.renderChannels();
	this.renderModules();
	this.updatePlayhead();
  }

  renderHeader() {
	this.headerSlots.innerHTML = '';
	for (let i = 0; i < this.totalSlots; i++) {
	  const div = document.createElement('div');
	  div.className = 'time-slot-header';
		if (i % 15 === 0)
		  div.textContent = barsToTime(i) // `${i * 2}s`;
	  this.headerSlots.appendChild(div);
	}
  }

  renderChannels() {
	this.channelsContainer.innerHTML = '';

	this.data.channels.forEach(channel => {
	  const channelDiv = document.createElement('div');
	  channelDiv.className = 'channel';

	  const header = document.createElement('div');
	  header.className = 'channel-header';
	  header.textContent = `Ch ${channel.id + 1}`;
	  channelDiv.appendChild(header);

	  const slotsContainer = document.createElement('div');
	  slotsContainer.className = 'channel-slots';

	  for (let i = 0; i < this.totalSlots; i++) {
		const slot = document.createElement('div');
		slot.className = 'slot';
		slot.dataset.channelId = channel.id;
		slot.dataset.position = i;
		slotsContainer.appendChild(slot);
	  }

	  channelDiv.appendChild(slotsContainer);
	  this.channelsContainer.appendChild(channelDiv);
	});
  }

  renderModules() {
	// Clear existing modules and connections
	this.querySelectorAll('.module-segment, .module-connection').forEach(el => el.remove());

	// Group modules by instance
	const instanceGroups = new Map();

	this.data.channels.forEach(channel => {
	  channel.modules.forEach(module => {
		if (!instanceGroups.has(module.instanceId)) {
		  instanceGroups.set(module.instanceId, []);
		}
		instanceGroups.get(module.instanceId).push({ ...module, channelId: channel.id });
	  });
	});

	// Render connections first
	instanceGroups.forEach((modules) => {
	  if (modules.length > 1) {
		modules.sort((a, b) => a.position - b.position);

		for (let i = 0; i < modules.length - 1; i++) {
		  const current = modules[i];
		  const next = modules[i + 1];

		  if (current.channelId === next.channelId) {
			this.renderConnection(current, next);
		  }
		}
	  }
	});

	// Render actual modules
	this.data.channels.forEach((channel, channelIndex) => {
	  const channelDiv = this.channelsContainer.children[channelIndex];
	  const slots = channelDiv.querySelectorAll('.slot');

	  channel.modules.forEach(module => {
		this.renderModuleSegments(slots, channel.id, module);
	  });
	});

	// Render shadow module on hover
	if (this.hoverInfo) {
	  const { channelId, position } = this.hoverInfo;
	  const channelIndex = this.data.channels.findIndex(c => c.id === channelId);
	  const channelDiv = this.channelsContainer.children[channelIndex];
	  const slots = channelDiv.querySelectorAll('.slot');

	  const shadowModule = {
		...this.selectedModule,
		position,
		id: -1
	  };

	  this.renderModuleSegments(slots, channelId, shadowModule, true);
	}
  }

  renderModuleSegments(slots, channelId, module, isShadow = false) {
	const color = CONFIG.COLORS[module.colorIndex];
	const symbol = CONFIG.SYMBOLS[module.symbolIndex];

	for (let i = 0; i < module.length; i++) {
	  const slotIndex = module.position + i;
	  if (slotIndex >= slots.length) continue;

	  const slot = slots[slotIndex];
		if (slot.childElementCount) {
			if (isShadow) return
			slot.innerHTML = ''
		}
	  const segment = document.createElement('div');
	  segment.className = 'module-segment' + (isShadow ? ' shadow' : '');

	  // Add position classes
	  if (module.length === 1) {
		segment.classList.add('first', 'last');
	  } else if (i === 0) {
		segment.classList.add('first');
	  } else if (i === module.length - 1) {
		segment.classList.add('last');
	  } else {
		segment.classList.add('middle');
	  }

	  segment.style.backgroundColor = color;
	  segment.style.borderColor = color;

	  // Only show symbol on first segment
	  // if (i === 0) {
		segment.textContent = symbol;
	  // }

	  if (!isShadow) {
		segment.dataset.channelId = channelId;
		segment.dataset.moduleId = module.id;
		segment.dataset.colorIndex = module.colorIndex;
		segment.dataset.symbolIndex = module.symbolIndex;
		segment.dataset.originalLength = module.originalLength;
	  }

	  slot.appendChild(segment);
	}
  }

  renderConnection(module1, module2) {
	const channelIndex = this.data.channels.findIndex(c => c.id === module1.channelId);
	const channelDiv = this.channelsContainer.children[channelIndex];
	const slotsContainer = channelDiv.querySelector('.channel-slots');

	const startSlot = module1.position + module1.length;
	const endSlot = module2.position;

	for (let i = startSlot; i < endSlot; i++) {
	  const slot = slotsContainer.children[i];
	  const connection = document.createElement('div');
	  connection.className = 'module-connection';
	  connection.style.width = (CONFIG.SLOT_WIDTH - 8) + 'px';
	  connection.style.backgroundColor = CONFIG.COLORS[module1.colorIndex];
	  slot.appendChild(connection);
	}
  }
}

customElements.define('trax-timeline', TraxTimeline);

// App initialization
document.addEventListener('DOMContentLoaded', () => {
  const timeline = document.getElementById('timeline');
  const addChannelBtn = document.getElementById('add-channel-btn');
  const playBtn = document.getElementById('play-btn');
  const stopBtn = document.getElementById('stop-btn');
  const modeSelector = document.getElementById('mode-selector');
  const colorSelector = document.getElementById('color-selector');
  const symbolSelector = document.getElementById('symbol-selector');
  const lengthSelector = document.getElementById('length-selector');
  const modulePreview = document.getElementById('module-preview');

  let selectedMode = "place";
  let selectedColor = 0;
  let selectedSymbol = 0;
  let selectedLength = 2;

  // Create color selector
  CONFIG.COLORS.forEach((color, index) => {
	const btn = document.createElement('div');
	btn.className = 'color-option';
	if (index === 0) btn.classList.add('active');
	btn.style.backgroundColor = color;

	btn.addEventListener('click', () => {
	  document.querySelectorAll('.color-option').forEach(b => b.classList.remove('active'));
	  btn.classList.add('active');
	  selectedColor = index;
	  updateSelection();
	});

	colorSelector.appendChild(btn);
  });

  // Create symbol selector
  CONFIG.SYMBOLS.forEach((symbol, index) => {
	const btn = document.createElement('div');
	btn.className = 'symbol-option';
	if (index === 0) btn.classList.add('active');
	btn.textContent = symbol;

	btn.addEventListener('click', () => {
	  document.querySelectorAll('.symbol-option').forEach(b => b.classList.remove('active'));
	  btn.classList.add('active');
	  selectedSymbol = index;
	  updateSelection();
	});

	symbolSelector.appendChild(btn);
  });

  // Length selector
  lengthSelector.addEventListener('change', (e) => {
	selectedLength = parseInt(e.target.value);
	updateSelection();
  });
  modeSelector.addEventListener('change', (e) => {
	selectedMode = e.target.value;
	updateSelection();
  });

  function updateSelection() {
	  timeline.setSelectedMode(selectedMode)
	timeline.setSelectedModule({
	  colorIndex: selectedColor,
	  symbolIndex: selectedSymbol,
	  length: selectedLength,
	  originalLength: selectedLength
	});
	updatePreview();
  }

  function updatePreview() {
	modulePreview.innerHTML = '';
	const color = CONFIG.COLORS[selectedColor];
	const symbol = CONFIG.SYMBOLS[selectedSymbol];

	for (let i = 0; i < selectedLength; i++) {
	  const segment = document.createElement('div');
	  segment.className = 'preview-segment';
	  segment.style.backgroundColor = color;
	  segment.style.borderColor = color;
	  segment.textContent = symbol;
	  modulePreview.appendChild(segment);
	}
  }

  // Event listeners
  addChannelBtn.addEventListener('click', () => {
	timeline.addChannel();
  });

  playBtn.addEventListener('click', () => {
	timeline.play();
  });

  stopBtn.addEventListener('click', () => {
	timeline.stop();
  });

  timeline.addEventListener('module-selected', (e) => {
	selectedColor = e.detail.colorIndex;
	selectedSymbol = e.detail.symbolIndex;
	selectedLength = e.detail.length;

	// Update UI
	document.querySelectorAll('.color-option').forEach((opt, i) => {
	  opt.classList.toggle('active', i === selectedColor);
	});
	document.querySelectorAll('.symbol-option').forEach((opt, i) => {
	  opt.classList.toggle('active', i === selectedSymbol);
	});
	lengthSelector.value = selectedLength;
	updatePreview();
  });

  updatePreview();
});
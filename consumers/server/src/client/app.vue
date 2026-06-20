<template>
	<NuxtPage />
</template>

<style>
body {
	margin: 0;
	background: #101419;
	color: #e9eef5;
	font-family:
		Inter,
		ui-sans-serif,
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		'Segoe UI',
		sans-serif;
}

.shell {
	width: min(960px, calc(100vw - 32px));
	margin: 0 auto;
	padding: 56px 0;
}

.hero,
.card,
.notice,
.error {
	border: 1px solid rgb(255 255 255 / 10%);
	border-radius: 24px;
	background: rgb(255 255 255 / 6%);
	box-shadow: 0 24px 70px rgb(0 0 0 / 24%);
}

.hero {
	padding: 40px;
	margin-bottom: 24px;
}

.hero h1 {
	max-width: 760px;
	margin: 0;
	font-size: clamp(2.5rem, 8vw, 5.5rem);
	line-height: 0.92;
	letter-spacing: -0.08em;
}

.hero p:last-child {
	max-width: 660px;
	color: #aebccd;
	font-size: 1.1rem;
}

.eyebrow {
	color: #77ddff;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.16em;
}

.grid {
	display: grid;
	gap: 20px;
}

.card,
.notice,
.error {
	padding: 24px;
	margin-bottom: 20px;
}

.accent {
	border-color: rgb(119 221 255 / 35%);
}

.stack {
	display: grid;
	gap: 16px;
	max-width: 520px;
}

.row {
	display: flex;
	gap: 16px;
	align-items: center;
	justify-content: space-between;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
}

label {
	display: grid;
	gap: 8px;
	color: #cdd7e3;
	font-weight: 700;
}

input {
	border: 1px solid rgb(255 255 255 / 15%);
	border-radius: 14px;
	padding: 12px 14px;
	background: rgb(0 0 0 / 26%);
	color: #fff;
	font: inherit;
}

button,
.button-link {
	border: 0;
	border-radius: 999px;
	padding: 12px 18px;
	background: #77ddff;
	color: #071016;
	font: inherit;
	font-weight: 800;
	text-decoration: none;
	cursor: pointer;
}

button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

button.secondary,
.button-link.secondary {
	background: rgb(255 255 255 / 12%);
	color: #f8fbff;
}

.notice {
	border-color: rgb(119 221 255 / 40%);
	color: #c5f3ff;
}

.error {
	border-color: rgb(255 123 123 / 42%);
	color: #ffd0d0;
}

.success {
	color: #9effc3;
}

.muted {
	color: #aebccd;
}

.portfolio-list {
	display: grid;
	gap: 12px;
	padding: 0;
	list-style: none;
}

.portfolio-list li {
	display: flex;
	gap: 12px;
	align-items: center;
	justify-content: space-between;
	border: 1px solid rgb(255 255 255 / 10%);
	border-radius: 18px;
	padding: 14px;
	background: rgb(0 0 0 / 18%);
}

.portfolio-list span {
	display: block;
	color: #aebccd;
}
</style>

---
title: "KaTeX 公式速查：从行内符号到多行推导"
date: "2025-09-14"
updated: "2026-10-05"
summary: "这篇文章本身就是一份渲染测试：行内公式、矩阵、分段函数、对齐推导、化学式般的上下标，全都在这里。"
tags: ["数学"]
---

数学排版是这个博客最想做好的一件事。下面既是速查表，也是渲染效果的实测。

## 行内与独立公式

行内公式用 `$...$` 包起来，比如欧拉恒等式 $e^{i\pi} + 1 = 0$，或者一个条件概率 $P(A \mid B) = \frac{P(A \cap B)}{P(B)}$。

独立公式用 `$$...$$`：

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi}\,\mathrm{d}x
$$

## 求和、极限与积分

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6},
\qquad
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

高斯积分大概是最常被写出来的式子之一：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}
$$

## 多行对齐推导

用 `aligned` 环境让等号对齐：

$$
\begin{aligned}
(a+b)^2 &= (a+b)(a+b) \\
        &= a^2 + ab + ba + b^2 \\
        &= a^2 + 2ab + b^2
\end{aligned}
$$

## 矩阵与行列式

$$
A = \begin{pmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23} \\
a_{31} & a_{32} & a_{33}
\end{pmatrix},
\qquad
\det \begin{vmatrix} a & b \\ c & d \end{vmatrix} = ad - bc
$$

## 分段函数

$$
\operatorname{ReLU}(x) =
\begin{cases}
x, & x > 0 \\
0, & x \le 0
\end{cases}
$$

## 一点机器学习里的常客

交叉熵损失：

$$
\mathcal{L} = -\frac{1}{N}\sum_{i=1}^{N}\sum_{c=1}^{C} y_{i,c}\log \hat{y}_{i,c}
$$

Softmax：

$$
\sigma(\mathbf{z})_j = \frac{e^{z_j}}{\sum_{k=1}^{K} e^{z_k}}, \quad j = 1,\dots,K
$$

Attention（这大概是近十年被印得最多的公式）：

$$
\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V
$$

## 常用符号对照

| 写法 | 效果 | 写法 | 效果 |
| :-: | :-: | :-: | :-: |
| `\alpha \beta \gamma` | $\alpha \beta \gamma$ | `\leq \geq \neq` | $\leq \geq \neq$ |
| `\frac{a}{b}` | $\frac{a}{b}$ | `\sqrt[3]{x}` | $\sqrt[3]{x}$ |
| `\vec{v}` | $\vec{v}$ | `\mathbb{R}` | $\mathbb{R}$ |
| `\partial` | $\partial$ | `\nabla` | $\nabla$ |
| `\infty` | $\infty$ | `\approx` | $\approx$ |

## 小提示

如果公式里要写美元符号本身，记得转义成 `\$`，否则会被当成公式的起止标记。另外 KaTeX 在这里配置了 `throwOnError: false`——写错了不会白屏，只会把出错的片段标红，方便你继续改。

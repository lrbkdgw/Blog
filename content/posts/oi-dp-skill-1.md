---
title: "DP 优化和技巧"
date: "2026-10-16"
updated: "2026-10-16"
summary: "-"
tags: ["OI", "总结"]
---

**To Do List**

- 

### WQS 二分

### 猫树分治

猫树分治技巧通常用于：

- 无修改操作。
- 多次询问，给定起点和终点，求方案数或连通性等。
- 易求从某个固定点出发的答案。
- 有结合律。


方法：

- 先确定一条分割线，然后从分割线开始向两边 DP。
- 使用结合律处理所有跨越这条分割线的询问。
- 分治处理所有未跨越这条分割线的询问。

:::info[例题 1]{open}

https://www.luogu.com.cn/problem/P6240

设 $\text{mid}=\lfloor \frac{s+t}{2} \rfloor$，函数 $\text{solve}(s,t)$ 的功能为解决所有 $s \leq l_i \leq \text{mid} \leq r_i \leq t$，的询问 $i$，算法流程如下：

- 找到所有满足条件的询问，若没有则立即结束。
- 从 $\frac{s+t}{2}$ 开始，向左右分别做 01 背包 DP。总时间复杂度 $O(\text{len} \times w_t)$。
- 合并答案。对于询问 $i$，答案为 
  $$
  \max_{0 \leq k \leq t_i} f(k)+h(t_i-k)
  $$
  其中 $f,h$ 分别为左右 01 背包的结果。对于所有 $q$ 个询问，时间复杂度为 $O(qw_t)$。
- 递归 $\text{solve}(l,\text{mid})$ 和 $\text{solve}(\text{mid}+1,r)$。

可以发现上面很像线段树的递归过程~~因为这个算法就是基于线段树的思想~~。

快速找到满足条件的询问可以对于每个区间维护一个 `vector`，每个区间被递归时扫描 `vector` 内的所有询问，然后把不经过分割线的询问下放到子区间的 `vector`。

总时间复杂度为 $O(q \log n+nw_t \log n+qw_t)$。

:::

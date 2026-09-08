use frostfire_core::dag::{DagError, TaskNode, WorkstreamDag};

#[test]
fn test_dag_topological_sort() {
    let mut dag = WorkstreamDag::new("sprint-dag");

    dag.add_node(TaskNode::new("task-1", "Research", "sme_research"));
    dag.add_node(TaskNode::new("task-2", "Architecture", "sme_arch"));
    dag.add_node(TaskNode::new("task-3", "Synthesis", "pm_lead"));

    dag.add_dependency("task-2", "task-1").unwrap(); // task-2 depends on task-1
    dag.add_dependency("task-3", "task-2").unwrap(); // task-3 depends on task-2

    let order = dag.topological_sort().expect("DAG should sort cleanly");
    assert_eq!(order, vec!["task-1", "task-2", "task-3"]);
}

#[test]
fn test_dag_cycle_detection() {
    let mut dag = WorkstreamDag::new("cyclic-dag");

    dag.add_node(TaskNode::new("A", "Node A", "sme_1"));
    dag.add_node(TaskNode::new("B", "Node B", "sme_2"));
    dag.add_node(TaskNode::new("C", "Node C", "sme_3"));

    dag.add_dependency("B", "A").unwrap();
    dag.add_dependency("C", "B").unwrap();
    dag.add_dependency("A", "C").unwrap(); // Cycle: A -> B -> C -> A

    let res = dag.topological_sort();
    assert!(matches!(res, Err(DagError::CycleDetected)));
}
